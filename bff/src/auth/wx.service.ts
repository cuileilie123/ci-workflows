import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface Code2SessionResult {
  openid: string;
  sessionKey: string;
  unionid?: string;
}

interface WxCode2SessionResponse {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

/**
 * 微信小程序 code2Session 服务
 *
 * 注意：session_key 仅内存使用，不落库（specs/01-auth.md 安全要求）。
 * 开发环境若未配置 WX_APPID/WX_SECRET，返回 mock 数据以便联调。
 */
@Injectable()
export class WxService {
  private readonly logger = new Logger(WxService.name);
  private readonly appid: string;
  private readonly secret: string;

  constructor(private readonly config: ConfigService) {
    this.appid = this.config.get<string>('WX_APPID') ?? '';
    this.secret = this.config.get<string>('WX_SECRET') ?? '';
  }

  async code2Session(code: string): Promise<Code2SessionResult> {
    if (!this.appid || !this.secret) {
      this.logger.warn('WX_APPID/WX_SECRET 未配置，返回 mock openid（仅供本地联调）');
      return {
        openid: `mock_${code.slice(0, 16) || 'no_code'}`,
        sessionKey: 'mock_session_key',
      };
    }

    const url =
      `https://api.weixin.qq.com/sns/jscode2session` +
      `?appid=${this.appid}` +
      `&secret=${this.secret}` +
      `&js_code=${encodeURIComponent(code)}` +
      `&grant_type=authorization_code`;

    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { method: 'GET' });
        const data = (await res.json()) as WxCode2SessionResponse;

        if (data.errcode) {
          // 40163: code been used; 40029: invalid code; 45011: rate limit
          throw new BadRequestException(
            `微信 code2Session 失败: [${data.errcode}] ${data.errmsg ?? ''}`,
          );
        }
        if (!data.openid || !data.session_key) {
          throw new BadRequestException('微信 code2Session 返回数据异常');
        }
        return {
          openid: data.openid,
          sessionKey: data.session_key,
          unionid: data.unionid,
        };
      } catch (err) {
        // 业务错误（code 失效等）直接抛出，不重试
        if (err instanceof BadRequestException) throw err;
        lastError = err;
        this.logger.warn(`code2Session 第 ${attempt} 次失败: ${(err as Error).message}`);
        if (attempt < 3) {
          await sleep(Math.pow(2, attempt) * 300); // 0.6s, 1.2s 指数退避
        }
      }
    }
    throw new ServiceUnavailableException(
      `微信 API 不可用: ${(lastError as Error)?.message ?? 'unknown'}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
