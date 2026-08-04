/**
 * 微信小程序 WebSocket polyfill
 * 将 uni.connectSocket 封装为标准 WebSocket 接口，供 socket.io-client 使用
 * 必须在 socket.ts 之前导入
 */

const RS = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 } as const;

interface SocketTaskLike {
  onOpen?: (cb: () => void) => void;
  onMessage?: (cb: (res: { data: string | ArrayBuffer }) => void) => void;
  onClose?: (cb: (res: { code: number; reason: string }) => void) => void;
  onError?: (cb: (res: unknown) => void) => void;
  send: (opts: { data: string }) => void;
  close: (opts?: { code?: number; reason?: string }) => void;
}

class WebSocketPolyfill {
  static CONNECTING = RS.CONNECTING;
  static OPEN = RS.OPEN;
  static CLOSING = RS.CLOSING;
  static CLOSED = RS.CLOSED;

  readonly CONNECTING = RS.CONNECTING;
  readonly OPEN = RS.OPEN;
  readonly CLOSING = RS.CLOSING;
  readonly CLOSED = RS.CLOSED;

  readyState: number = RS.CONNECTING;
  binaryType: 'blob' | 'arraybuffer' = 'arraybuffer';
  url: string;

  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  private task: SocketTaskLike | null = null;

  constructor(url: string) {
    this.url = url;
    const task = uni.connectSocket({
      url,
      fail: () => {},
    }) as unknown as SocketTaskLike;
    this.task = task;

    task.onOpen?.(() => {
      this.readyState = RS.OPEN;
      this.onopen?.();
    });

    task.onMessage?.((res: { data: string | ArrayBuffer }) => {
      this.onmessage?.({ data: res.data });
    });

    task.onClose?.((res: { code: number; reason: string }) => {
      this.readyState = RS.CLOSED;
      this.onclose?.({ code: res.code, reason: res.reason });
    });

    task.onError?.(() => {
      this.onerror?.(null);
    });
  }

  send(data: string): void {
    this.task?.send({ data });
  }

  close(code?: number, reason?: string): void {
    this.readyState = RS.CLOSING;
    this.task?.close({ code, reason });
  }
}

// 注入全局 WebSocket（socket.io-client 依赖此全局对象）
(globalThis as unknown as { WebSocket: unknown }).WebSocket = WebSocketPolyfill;

export default WebSocketPolyfill;
