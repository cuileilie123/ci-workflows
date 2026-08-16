// 微信订阅消息工具
import { tracker, EVENTS } from '@/utils/track';

// ============================================================================
// 🔴 生产环境部署前必读：订阅消息模板 ID 申请指南 🔴
// ============================================================================
// 当前模板 ID 为占位符，直接调用 wx.requestSubscribeMessage 会被微信拒绝。
// 需要在微信公众平台 (https://mp.weixin.qq.com) 手动申请：
//   1. 登录小程序后台 → 功能 → 订阅消息 → 我的模板
//   2. 在「公共模板库」中搜索并添加以下模板（找不到的可以用相似模板或自制模板）：
//      - ORDER_STATUS   : 「订单状态变更通知」（含字段：订单号、状态、变更时间）
//      - NEW_TASK_NEARBY: 「新任务提醒」    （含字段：任务名称、酬金、位置）
//      - PAYMENT_REMINDER:「支付提醒通知」  （含字段：订单金额、过期时间）
//      - REVIEW_REMINDER :「评价提醒」      （含字段：评价对象、评分）
//   3. 每条模板「详情」中可看到「模板 ID」，复制后替换下方对应位置
//   4. 替换完成后，将下方 const DEBUG = true 改为 DEBUG = false
//
// 小程序订阅消息官方文档：
//   https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message.html
// ============================================================================
const DEBUG = true; // 仍为占位符时保持 true，订阅请求会被跳过但打印警告

const TMPL_IDS: Record<string, string> = {
  ORDER_STATUS: 'tmpl_order_status_placeholder',
  NEW_TASK_NEARBY: 'tmpl_new_task_placeholder',
  PAYMENT_REMINDER: 'tmpl_pay_remind_placeholder',
  REVIEW_REMINDER: 'tmpl_review_placeholder',
};

/** 判断一个模板 ID 是否仍是占位符 */
function isPlaceholder(id: string): boolean {
  return !id || id.endsWith('_placeholder') || id.length < 10;
}

/** 过滤出有效的模板 ID，返回 [有效ID数组, 无效类型数组] */
function filterValid(types: string[]): [string[], string[]] {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const t of types) {
    const id = TMPL_IDS[t];
    if (id && !isPlaceholder(id)) {
      valid.push(id);
    } else {
      invalid.push(t);
    }
  }
  return [valid, invalid];
}

function reportSubscribeResult(res: Record<string, string>): void {
  Object.entries(res).forEach(([tmplId, status]) => {
    tracker.track(EVENTS.SUBSCRIBE, {
      tmplId,
      status,
      page: getCurrentPage(),
    });
  });
}

function getCurrentPage(): string {
  try {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const route = pages.length > 0 ? (pages[pages.length - 1] as { route?: unknown })?.route : 'unknown';
    // 验证路由字符串的安全性，防止注入
    if (typeof route === 'string' && /^[a-zA-Z0-9/_-]+$/.test(route)) {
      return route;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 微信订阅消息 API（Promise 形式，base 库 2.8.2+ 在无 callback 时返回 Promise） */
interface WxSubscribeAPI {
  requestSubscribeMessage(options: { tmplIds: string[] }): Promise<Record<string, string>>;
}

export async function requestSubscribe(types: string[]): Promise<void> {
  const [tmplIds, invalidTypes] = filterValid(types);

  // 有占位符模板时给出开发阶段警告（不抛异常，不中断用户流程）
  if (invalidTypes.length > 0 && typeof console !== 'undefined') {
    console.warn(
      `[Subscribe] 以下订阅类型仍使用占位符模板 ID，已跳过: ${invalidTypes.join(', ')}. ` +
      '请在微信公众平台申请模板并替换 utils/subscribe.ts 中的 TMPL_IDS，' +
      '然后将 DEBUG = false。'
    );
  }

  // DEBUG 模式或无有效模板 → 静默跳过，避免调用微信 API 被拒绝
  if (DEBUG || tmplIds.length === 0) return;

  try {
    const wxApi = (typeof wx !== 'undefined' ? wx : undefined) as unknown as WxSubscribeAPI | undefined;
    if (!wxApi || typeof wxApi.requestSubscribeMessage !== 'function') {
      console.warn('[Subscribe] 当前环境不支持订阅消息');
      return;
    }

    const res = await wxApi.requestSubscribeMessage({ tmplIds });
    if (typeof res === 'object' && res !== null) {
      reportSubscribeResult(res);
    }
  } catch (e) {
    console.warn('[Subscribe] 订阅消息失败', e);
  }
}

export function subscribeOnTaskPublish(): void {
  requestSubscribe(['ORDER_STATUS', 'NEW_TASK_NEARBY']);
}

export function subscribeOnOrderCreate(): void {
  requestSubscribe(['ORDER_STATUS', 'PAYMENT_REMINDER']);
}

export function subscribeOnOrderComplete(): void {
  requestSubscribe(['REVIEW_REMINDER']);
}
