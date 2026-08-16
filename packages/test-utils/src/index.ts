/**
 * 邻里互助项目通用测试辅助工具。
 *
 * 供 bff / frontend / backend 等 workspace 复用，避免在各 spec 文件中重复定义
 * 日志、计时、模块清理等样板代码。
 */

/**
 * 创建带时间戳的测试日志函数，用于排查资源泄漏和模块销毁时序问题。
 *
 * 每条日志格式：`[tag] ISO_TIMESTAMP message`
 *
 * @param tag 日志前缀标识，通常为 spec 文件名（如 `'lock-alert.spec'`）
 * @returns 日志函数，调用即输出到 console
 *
 * @example
 * const log = createTestLogger('lock-alert.spec');
 * log('beforeEach: 模块已编译');
 * // 输出: [lock-alert.spec] 2026-08-07T15:40:24.503Z beforeEach: 模块已编译
 */
export function createTestLogger(tag: string): (msg: string) => void {
  return (msg: string) =>
    console.log(`[${tag}] ${new Date().toISOString()} ${msg}`);
}

/**
 * 同步计时器：测量函数执行耗时，返回结果与毫秒数。
 *
 * @example
 * const { result, elapsedMs } = timedSync(() => moduleRef.close());
 * log(`afterEach: 模块已关闭，耗时 ${elapsedMs}ms`);
 */
export function timedSync<T>(fn: () => T): { result: T; elapsedMs: number } {
  const t0 = Date.now();
  const result = fn();
  return { result, elapsedMs: Date.now() - t0 };
}

/**
 * 异步计时器：测量 Promise 函数执行耗时。
 *
 * @example
 * const { result, elapsedMs } = await timedAsync(() => moduleRef.close());
 * log(`afterAll: 模块已关闭，耗时 ${elapsedMs}ms`);
 */
export async function timedAsync<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; elapsedMs: number }> {
  const t0 = Date.now();
  const result = await fn();
  return { result, elapsedMs: Date.now() - t0 };
}
