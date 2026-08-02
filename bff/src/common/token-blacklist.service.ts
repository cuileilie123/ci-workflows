import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * Token 黑名单服务（用于登出失效 / Refresh Token 轮换）
 *
 * 当前实现：进程内 Map（hash -> 过期时间戳）。
 * - 单实例 BFF 足够；多实例部署需替换为 Redis Set（specs/01-auth.md）。
 * - 存储 token 的 sha256 摘要，不保留原文。
 */
@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);
  private readonly store = new Map<string, number>();

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** 将 token 加入黑名单，ttlSec 后自动失效 */
  blacklist(token: string, ttlSec: number): void {
    if (!token || ttlSec <= 0) return;
    const h = this.hash(token);
    this.store.set(h, Date.now() + ttlSec * 1000);
    this.logger.debug(`token 加入黑名单 (ttl=${ttlSec}s)`);
    // 顺手清理已过期项，避免内存无限增长
    if (this.store.size > 1000) this.cleanup();
  }

  /** 判断 token 是否在黑名单中（且未过期） */
  isBlacklisted(token: string): boolean {
    if (!token) return false;
    const h = this.hash(token);
    const exp = this.store.get(h);
    if (exp === undefined) return false;
    if (Date.now() >= exp) {
      this.store.delete(h);
      return false;
    }
    return true;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [k, exp] of this.store) {
      if (now >= exp) this.store.delete(k);
    }
  }
}
