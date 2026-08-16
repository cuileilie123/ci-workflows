import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, ForbiddenException } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { MetricsService } from './common/metrics.service';

// 为 express Request 增加 reqId 字段（供后续中间件/Controller 读取）
declare module 'express' {
  interface Request {
    reqId?: string;
  }
}

/** 从请求头里提取真实客户端 IP（兼容 Nginx/CDN 代理） */
function resolveClientIp(req: Request): string {
  const fwd = req.header('X-Forwarded-For');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.header('X-Real-IP');
  if (real) return real;
  return (req.ip || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

/** 截断长字符串，避免 UA/Referer 造成日志单行过大 */
function trunc(value: string | undefined, max = 160): string {
  if (!value) return '-';
  const s = value.trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}...(+${s.length - max})` : s;
}

// Prisma 的 BigInt 默认无法 JSON 序列化，全局转为字符串
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

/**
 * 解析 CORS 白名单。
 *
 * 优先级：
 *   1) 环境变量 CORS_ORIGINS（逗号分隔，精确字符串或 /pattern/ 包裹的正则）
 *   2) 内置默认白名单：微信小程序 + 本地开发 + H5 正式域
 *
 * 示例：CORS_ORIGINS="https://h5.example.com,https://admin.example.com"
 */
export function parseCorsOrigins(envRaw: string | undefined): Array<string | RegExp> {
  const builtIn: Array<string | RegExp> = [
    'https://servicewechat.com', // 微信小程序 web-view / 支付回跳
    'https://neighborhood-help.com', // H5 正式域
    'https://www.neighborhood-help.com', // H5 正式域（www）
    /http:\/\/localhost:\d+$/, // 本地开发 H5 / Vite dev server
    /http:\/\/127\.0\.0\.1:\d+$/, // 本地开发 IP 形式
  ];
  if (!envRaw) return builtIn;
  const custom = envRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const m = item.match(/^\/(.+)\/$/);
      return m ? new RegExp(m[1]) : item;
    });
  return [...builtIn, ...custom];
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 安全头
  app.use(helmet());

  // 请求 ID 中间件（所有请求都能拿到 reqId，写入 X-Request-Id 响应头，便于日志串联）
  app.use((req: Request, res: Response, next: NextFunction) => {
    const reqId = (req.header('X-Request-Id') || randomUUID()).replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 64) || randomUUID();
    req.reqId = reqId;
    res.setHeader('X-Request-Id', reqId);
    next();
  });

  // 本地开发静态资源（COS 未配置时，上传的图片通过 /uploads/ 访问）
  const uploadsDir = join(process.cwd(), 'uploads');
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
  app.useStaticAssets(uploadsDir, { prefix: '/uploads/' });

  // CORS（来源白名单：微信小程序 + 本地开发 + H5 正式域；可通过 CORS_ORIGINS 追加）
  const allowedOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);

  // 拿到全局 MetricsService 单例（CommonModule 已 @Global 导出），
  // 在 CORS 中间件里同步打 Prometheus Counter，供 alert_rules.yml 的 cors_alerts 规则评估
  const metricsService = app.get(MetricsService);

  // 前置 Origin 预检拦截中间件：
  //   - 合法浏览器来源：打 info 日志（LOG-CO-002）+ inc cors_allowed_total，进入 cors 包写回 Allow-Origin 头
  //   - 非法浏览器来源：打 warn 日志（LOG-CO-001）+ inc cors_blocked_total，直接返回 403 Forbidden（由 AllExceptionsFilter 落盘 error 日志形成双保险）
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const origin = req.header('Origin');
    if (!origin) return next(); // 同源 / 非浏览器请求（小程序直连 / 服务间调用）
    const reqId = req.reqId || '-';
    const ip = resolveClientIp(req);
    const ua = trunc(req.header('User-Agent'));
    const ref = trunc(req.header('Referer'));
    const method = req.method;
    const path = req.originalUrl;

    const ok = allowedOrigins.some((rule) =>
      rule instanceof RegExp ? rule.test(origin) : rule === origin,
    );
    if (ok) {
      Logger.log(
        `[LOG-CO-002] reqId=${reqId} ip=${ip} method=${method} path=${path} ` +
          `origin=${origin} ua=${ua} referer=${ref} status=allowed`,
        'CORS',
      );
      metricsService.recordCorsAllowed(origin, method, path);
      return next();
    }
    Logger.warn(
      `[LOG-CO-001] reqId=${reqId} ip=${ip} method=${method} path=${path} ` +
        `origin=${origin} ua=${ua} referer=${ref} status=403`,
      'CORS',
    );
    metricsService.recordCorsBlocked(origin, ip, method, path);
    throw new ForbiddenException(`CORS 拒绝来源: ${origin}`);
  });

  app.enableCors({
    origin: true, // 前置中间件已严格校验，此处直接放行
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With', 'Accept', 'X-Device-Fp'],
    exposedHeaders: ['X-Request-Id'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });
  logger.log(
    `[CORS] 白名单生效: ${allowedOrigins.map((o) => (o instanceof RegExp ? o.toString() : o)).join(', ')}`,
  );

  // 全局前缀（/metrics 端点排除，供 Prometheus 抓取）
  app.setGlobalPrefix('api/v1', {
    exclude: ['metrics'],
  });

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // 全局异常过滤器 + 响应拦截器
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  // Swagger 文档
  const config = new DocumentBuilder()
    .setTitle('邻里互助 BFF API')
    .setDescription('社区邻里有偿互助平台 - BFF 层接口文档')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ?? 3000;
  // 监听 ::1 同时覆盖 IPv4 与 IPv6（Node.js 在未指定 host 时会绑定 ::1 并通过 dual-stack 支持 IPv4）
  await app.listen(port);
  logger.log(`🚀 BFF running on http://localhost:${port}`);
  logger.log(`📚 Swagger docs at http://localhost:${port}/docs`);
}

bootstrap();
