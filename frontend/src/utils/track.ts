import { useUserStore } from '@/store/user';
import { request } from '@/utils/request';

interface TrackEvent {
  event: string;
  props: Record<string, unknown>;
  userId?: number;
  timestamp: number;
  sessionId: string;
}

/** 页面实例上可读取路由信息的最小类型 */
interface PageRouteInfo {
  route?: unknown;
}

class Tracker {
  private queue: TrackEvent[] = [];
  private sessionId = this.genSessionId();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private pageHideHandler: (() => void) | null = null;

  constructor() {
    // 每 10 秒批量上报
    this.flushTimer = setInterval(() => this.flush(), 10000);

    // 页面隐藏时立即上报
    if (typeof wx !== 'undefined' && typeof wx.onAppHide === 'function') {
      this.pageHideHandler = () => this.flush();
      wx.onAppHide(this.pageHideHandler);
    }
  }

  genSessionId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  track(event: string, props: Record<string, unknown> = {}) {
    const userStore = useUserStore();
    this.queue.push({
      event,
      props: { ...props, page: this.getCurrentPage() },
      userId: userStore.userInfo?.id ? parseInt(userStore.userInfo.id) : undefined,
      timestamp: Date.now(),
      sessionId: this.sessionId
    });

    // 关键事件立即上报
    if (['pay_success', 'order_create', 'task_publish'].includes(event)) {
      this.flush();
    }
  }

  private getCurrentPage(): string {
    try {
      // 安全地获取当前页面，防止 getCurrentPages 不存在或抛错
      const pages: PageRouteInfo[] = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      const route = pages.length > 0 ? pages[pages.length - 1]?.route : 'unknown';
      // 验证路由字符串的安全性，防止注入
      if (typeof route === 'string' && /^[a-zA-Z0-9/_-]+$/.test(route)) {
        return route;
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async flush() {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);
    try {
      await request<{ events: TrackEvent[] }>({
        url: '/track',
        method: 'POST',
        data: { events: batch } as unknown as Record<string, unknown>,
        _skipAuthRefresh: true,
        _silent: true,
      });
    } catch (err) {
      // 埋点失败不应影响用户流程，静默放回队列头部
      console.warn('埋点数据上报失败', err);
      this.queue.unshift(...batch);
    }
  }

  // 页面停留时长
  trackPageView(pageName: string) {
    const startTime = Date.now();
    return () => {
      const duration = Date.now() - startTime;
      this.track('page_view', { page: pageName, duration });
    };
  }

  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flush();
      this.flushTimer = null;
    }
  }
}

export const tracker = new Tracker();

// 全局事件名常量
export const EVENTS = {
  APP_LAUNCH: 'app_launch',
  PAGE_VIEW: 'page_view',
  TASK_PUBLISH: 'task_publish',
  TASK_CLICK: 'task_click',
  ORDER_CREATE: 'order_create',
  PAY_SUCCESS: 'pay_success',
  PAY_FAIL: 'pay_fail',
  ORDER_ACCEPT: 'order_accept',
  ORDER_COMPLETE: 'order_complete',
  REVIEW_SUBMIT: 'review_submit',
  SHARE_CLICK: 'share_click',
  SEARCH: 'search',
  SUBSCRIBE: 'subscribe',
  CHAT_MESSAGE_SEND: 'chat_message_send',
  WITHDRAW_OPEN: 'withdraw_open',
  WITHDRAW_SUBMIT: 'withdraw_submit',
  WITHDRAW_SUCCESS: 'withdraw_success',
  WITHDRAW_FAIL: 'withdraw_fail',
  UPLOAD_START: 'upload_start',
  UPLOAD_SUCCESS: 'upload_success',
  UPLOAD_FAIL: 'upload_fail',
  FEEDBACK_SUBMIT: 'feedback_submit',
} as const;

// 自动埋点方法
export function autoTrackPageView(pageName: string) {
  const cleanup = tracker.trackPageView(pageName);
  // uni.onUnload 并非标准 API（页面级 onUnload 需从 @dcloudio/uni-app 导入），
  // 此处仅在小程序运行时存在该属性时调用，保证安全降级。
  const uniWithUnload = uni as unknown as { onUnload?: (cb: () => void) => void } | undefined;
  if (uniWithUnload && typeof uniWithUnload.onUnload === 'function') {
    uniWithUnload.onUnload(cleanup);
  }
}
