import { Injectable } from '@nestjs/common';
import { Registry, Counter, collectDefaultMetrics } from 'prom-client';

/**
 * 全局 Prometheus 指标服务
 * 通过 /metrics 端点暴露指标，由 Prometheus 抓取后触发 AlertManager 告警
 */
@Injectable()
export class MetricsService {
  readonly registry: Registry;

  /** 分账结果计数器（按 result 标签区分 success/fail/exception） */
  readonly profitShareCounter: Counter<string>;

  /** CORS 拦截计数器（非法来源 403，按 origin/ip/method/path 维度聚合） */
  readonly corsBlockedCounter: Counter<string>;

  /** CORS 放行计数器（合法来源 204，按 origin/method/path 维度聚合，用于白名单未误杀监控） */
  readonly corsAllowedCounter: Counter<string>;

  constructor() {
    this.registry = new Registry();

    // 采集 Node.js 默认指标（事件循环延迟、GC、内存等）
    collectDefaultMetrics({ register: this.registry });

    this.profitShareCounter = new Counter({
      name: 'profit_share_total',
      help: '分账调用结果计数（success=成功, fail=分账未完成, exception=调用异常）',
      labelNames: ['result', 'receiver_mch_id'] as const,
      registers: [this.registry],
    });

    this.corsBlockedCounter = new Counter({
      name: 'cors_blocked_total',
      help:
        'CORS 拦截计数器（前置中间件判定为非法来源 → 返回 403）。' +
        '与日志锚点 [LOG-CO-001] 一一对应，供 alert_rules.yml 的 CORSBlockedHigh 等告警规则使用。',
      labelNames: ['origin', 'ip', 'method', 'path'] as const,
      registers: [this.registry],
    });

    this.corsAllowedCounter = new Counter({
      name: 'cors_allowed_total',
      help:
        'CORS 放行计数器（前置中间件判定为合法来源 → 进入后续 cors 包写回 Allow-Origin）。' +
        '与日志锚点 [LOG-CO-002] 一一对应，用于白名单流量看板和白名单未误杀监控。',
      labelNames: ['origin', 'method', 'path'] as const,
      registers: [this.registry],
    });
  }

  /** 记录分账成功 */
  recordSuccess(receiverMchId: string): void {
    this.profitShareCounter.inc({ result: 'success', receiver_mch_id: receiverMchId });
  }

  /** 记录分账未完成（跳过/返回空 shareOrderId） */
  recordFail(receiverMchId: string): void {
    this.profitShareCounter.inc({ result: 'fail', receiver_mch_id: receiverMchId });
  }

  /** 记录分账调用异常（LOG-PS-108 catch 分支） */
  recordException(receiverMchId: string): void {
    this.profitShareCounter.inc({ result: 'exception', receiver_mch_id: receiverMchId });
  }

  /**
   * 记录 CORS 拦截（403 非法来源）
   * 与 main.ts 中间件的 [LOG-CO-001] WARN 日志一一对应
   */
  recordCorsBlocked(origin: string, ip: string, method: string, path: string): void {
    this.corsBlockedCounter.inc({ origin, ip, method, path });
  }

  /**
   * 记录 CORS 放行（合法来源）
   * 与 main.ts 中间件的 [LOG-CO-002] LOG 日志一一对应
   */
  recordCorsAllowed(origin: string, method: string, path: string): void {
    this.corsAllowedCounter.inc({ origin, method, path });
  }

  /** 返回 Prometheus 格式的指标文本 */
  async metrics(): Promise<string> {
    return this.registry.metrics();
  }

  /** 返回 Content-Type */
  get contentType(): string {
    return this.registry.contentType;
  }
}
