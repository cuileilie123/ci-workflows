---
name: nestjs-init
description: 初始化 NestJS BFF 项目骨架
model: claude-4-sonnet
tags: [bff, setup]
depends_on: []
---

# 任务：初始化 NestJS BFF 项目

## 目标
创建 NestJS 10.x + TypeScript BFF 项目，配置好鉴权、数据库、缓存、文档。

## 具体步骤

### 1. 使用 Nest CLI 创建项目
```bash
nest new bff --package-manager pnpm
```

### 2. 安装依赖
```bash
pnpm add @nestjs/config @nestjs/jwt @nestjs/passport passport passport-jwt
pnpm add @nestjs/prisma prisma @prisma/client
pnpm add @nestjs/redis redis
pnpm add @nestjs/swagger class-validator class-transformer
pnpm add helmet cors express-rate-limit
pnpm add -D prisma @types/passport-jwt
```

### 3. 项目结构
```
src/
├── main.ts              # 入口
├── app.module.ts        # 根模块
├── config/              # 配置
│   ├── env.validation.ts
│   └── swagger.config.ts
├── common/              # 公共模块
│   ├── filters/         # 异常过滤器
│   ├── interceptors/    # 拦截器
│   ├── middleware/      # 中间件
│   ├── decorators/      # 自定义装饰器
│   └── guards/          # 守卫
├── modules/             # 业务模块
│   ├── auth/
│   ├── task/
│   ├── order/
│   ├── wallet/
│   ├── chat/
│   └── user/
└── prisma/              # Prisma Schema
    └── schema.prisma
```

### 4. 全局配置 `main.ts`
```typescript
async function bootstrap() {
  const app = NestFactory.create(AppModule);
  
  // 安全头
  app.use(helmet());
  
  // CORS（仅允许微信小程序域名）
  app.enableCors({ origin: ['https://servicewechat.com'] });
  
  // 全局前缀
  app.setGlobalPrefix('api/v1');
  
  // 全局验证管道
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  
  // Swagger 文档
  const config = new DocumentBuilder()
    .setTitle('邻里互助 BFF API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
  
  await app.listen(3000);
}
```

### 5. Prisma Schema 初始化
- 定义 User, Task, Order, Wallet, Transaction, Review 模型
- 运行 `prisma migrate dev --name init`
- 生成 Prisma Client

### 6. JWT 鉴权模块
- `JwtStrategy`：验证 HS256 签名，提取 `userId`
- `AuthGuard`：装饰器 `@UseGuards(JwtAuthGuard)`
- Token 过期时间：Access 2h，Refresh 7d

### 7. 统一响应格式
```typescript
// 拦截器：包装所有响应
export interface ApiResponse<T> {
  code: number;      // 200 成功，其他失败
  message: string;
  data: T;
}
```

### 8. 统一异常处理
```typescript
// 过滤器：捕获所有异常
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception, host) {
    // 区分 HttpException / PrismaException / 未知异常
    // 返回统一格式 { code, message, data: null }
  }
}
```

## 验收标准
- [ ] `pnpm start:dev` 正常启动
- [ ] `/api/v1/health` 返回 200
- [ ] `/docs` Swagger 页面可访问
- [ ] Prisma 连接数据库成功
- [ ] JWT 鉴权中间件生效
- [ ] 全局异常格式统一

## 参考文件
- `.trae/memory.md` → 技术栈 + 禁止事项
- `specs/01-auth.md` → Token 刷新机制
