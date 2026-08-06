import { Injectable, Logger } from '@nestjs/common';

export type LockAlertLevel = 'WARNING' | 'ERROR' | 'CRITICAL';

export interface LockAlertContext {
  /** 锁 key */
  lockKey: string;
  /** 锁持有者 value */
  lockValue: string;
  /** 锁已持有时长（毫秒） */
  heldMs: number;
  /** TTL 配置（秒） */
  ttlSec: number;
  /** 告警级别 */
  level: LockAlertLevel;
  /** 业务上下文描述 */
  context?: string;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 分布式锁告警服务。
 *
 * 负责在锁获取失败或持有超时时，通过日志和可选的 Webhook（钉钉/飞书）发送告警。
 * Webhook URL 通过环境变量 LOCK_ALERT_WEBHOOK 配置，未配置时仅记录日志。
 */
@Injectable()
export class LockAlertService {
  private readonly logger = new Logger('LOCK-ALERT');
  private readonly webhookUrl: string | null;
  private readonly enabled: boolean;

  constructor() {
    this.webhookUrl = process.env.LOCK_ALERT_WEBHOOK || null;
    this.enabled = process.env.LOCK_ALERT_ENABLED !== 'false';
  }

  /**
   * 发送锁告警
   */
  async sendAlert(ctx: LockAlertContext): Promise<void> {
    if (!this.enabled) return;

    const msg = this.formatMessage(ctx);

    switch (ctx.level) {
      case 'CRITICAL':
        this.logger.error(msg);
        break;
      case 'ERROR':
        this.logger.error(msg);
        break;
      case 'WARNING':
        this.logger.warn(msg);
        break;
    }

    if (this.webhookUrl) {
      await this.sendWebhook(ctx, msg).catch((err) => {
        this.logger.warn(`Webhook 告警发送失败: ${(err as Error).message}`);
      });
    }
  }

  /**
   * 快速告警：锁获取失败
   */
  async onLockAcquireFailed(
    lockKey: string,
    holderUserId: string,
    context?: string,
  ): Promise<void> {
    await this.sendAlert({
      lockKey,
      lockValue: holderUserId,
      heldMs: 0,
      ttlSec: 0,
      level: 'ERROR',
      context: context || '锁获取失败',
      metadata: { type: 'ACQUIRE_FAILED', timestamp: Date.now() },
    });
  }

  /**
   * 锁持有超时告警
   */
  async onLockTimeout(
    lockKey: string,
    lockValue: string,
    heldMs: number,
    ttlSec: number,
    context?: string,
  ): Promise<void> {
    const level: LockAlertLevel = heldMs > ttlSec * 1000 * 3 ? 'CRITICAL' : heldMs > ttlSec * 1000 * 2 ? 'ERROR' : 'WARNING';

    await this.sendAlert({
      lockKey,
      lockValue,
      heldMs,
      ttlSec,
      level,
      context: context || '锁持有超时',
      metadata: { type: 'LOCK_TIMEOUT', timestamp: Date.now() },
    });
  }

  /**
   * 锁被强制释放（TTL 到期后被他人获取）
   */
  async onLockForceReleased(
    lockKey: string,
    originalHolder: string,
    newHolder: string,
    context?: string,
  ): Promise<void> {
    await this.sendAlert({
      lockKey,
      lockValue: `原持有者=${originalHolder}, 新持有者=${newHolder}`,
      heldMs: 0,
      ttlSec: 0,
      level: 'CRITICAL',
      context: context || '锁被强制覆盖（可能存在并发冲突）',
      metadata: { type: 'LOCK_FORCE_RELEASED', timestamp: Date.now() },
    });
  }

  private formatMessage(ctx: LockAlertContext): string {
    const duration = ctx.heldMs > 0 ? `${(ctx.heldMs / 1000).toFixed(1)}s` : '-';
    const ttl = ctx.ttlSec > 0 ? `${ctx.ttlSec}s` : '-';
    const tag = `[${ctx.level}]`;
    const context = ctx.context ? ` [${ctx.context}]` : '';
    return `${tag}${context} 分布式锁告警 | key=${ctx.lockKey} | holder=${ctx.lockValue} | 持有=${duration} | TTL=${ttl}`;
  }

  private async sendWebhook(ctx: LockAlertContext, msg: string): Promise<void> {
    const payload = {
      msgtype: 'text',
      text: { content: msg },
      timestamp: Date.now(),
      level: ctx.level,
      metadata: ctx.metadata,
    };

    await fetch(this.webhookUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  }
}