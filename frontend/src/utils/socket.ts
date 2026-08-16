// 必须在 socket.io-client 之前导入，注入全局 WebSocket polyfill
import './socket-polyfill';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from '@/utils/request';
import type {
  ChatMessage,
  MessageReadPayload,
  SendMessagePayload,
} from '@/types/chat';

/** HTTP → WebSocket URL 转换 */
function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, 'ws') + '/chat';
}

const WS_BASE = toWsUrl(import.meta.env.VITE_API_BASE_URL as string);

/** 小程序 app 实例上挂载的调试相关字段类型 */
interface SocketDebugApp {
  globalData?: {
    __listenerCounts?: string;
    getListenerCounts?: typeof getListenerCounts;
    [key: string]: unknown;
  };
  __listenerCounts?: string;
  getListenerCounts?: typeof getListenerCounts;
  setSocketDebug?: (enabled: boolean) => void;
  getConnectionStatus?: () => { connected: boolean; connecting: boolean };
}

// ---- 事件监听器注册 ----
type Listener<T> = (data: T) => void;

const listeners = {
  message: [] as Listener<ChatMessage>[],
  offline: [] as Listener<ChatMessage[]>[],
  read: [] as Listener<MessageReadPayload>[],
  kicked: [] as Listener<void>[],
  connection: [] as Listener<boolean>[],
};

/** 获取监听器数量（用于调试） */
export function getListenerCounts(): Record<string, number> {
  return {
    message: listeners.message.length,
    offline: listeners.offline.length,
    read: listeners.read.length,
    kicked: listeners.kicked.length,
    connection: listeners.connection.length,
  };
}

/** 将当前监听器数量同步到全局，供自动化测试读取 */
function updateGlobalDebug(): void {
  try {
    const data = JSON.stringify(getListenerCounts());
    if (typeof getApp !== 'undefined') {
      const app = getApp() as SocketDebugApp | undefined;
      if (app) {
        if (app.globalData && typeof app.globalData === 'object') {
          app.globalData.__listenerCounts = data;
          app.globalData.getListenerCounts = getListenerCounts;
        }
        app.__listenerCounts = data;
        app.getListenerCounts = getListenerCounts;
      }
    }
  } catch (error) {
    console.warn('[socket-debug] 更新全局调试信息失败', error);
  }
}

let debugEnabled = false;
export function setSocketDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

function debugLog(msg: string): void {
  if (debugEnabled) {
    const counts = getListenerCounts();
    console.log(`[socket-debug] ${msg} | listeners=${JSON.stringify(counts)}`);
  }
}

function notify<T>(key: keyof typeof listeners, data: T): void {
  (listeners[key] as Listener<T>[]).forEach((fn) => fn(data));
}

let socket: Socket | null = null;
let connecting = false;

/** 建立 WebSocket 连接（单例） */
export function connectSocket(): Socket {
  if (socket?.connected) return socket;
  if (connecting) return socket!;

  connecting = true;
  const token = getAccessToken();
  if (!token) {
    connecting = false;
    throw new Error('未登录，无法连接聊天服务');
  }

  socket = io(WS_BASE, {
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 16000,
    timeout: 10000,
  });

  socket.on('connect', () => {
    connecting = false;
    notify('connection', true);
  });

  socket.on('disconnect', (reason: string) => {
    notify('connection', false);
    // 服务端主动断开（如被踢），不自动重连
    if (reason === 'io server disconnect' && socket) {
      socket.io.opts.reconnection = false;
    }
  });

  socket.on('connect_error', () => {
    connecting = false;
    notify('connection', false);
  });

  socket.on('new_message', (msg: ChatMessage) => {
    notify('message', msg);
  });

  socket.on('offline_messages', (msgs: ChatMessage[]) => {
    notify('offline', msgs);
  });

  socket.on('message_read', (payload: MessageReadPayload) => {
    notify('read', payload);
  });

  socket.on('kicked', () => {
    notify('kicked', undefined);
    if (socket) {
      socket.io.opts.reconnection = false;
      socket.disconnect();
    }
  });

  return socket;
}

/** 断开连接 */
export function disconnectSocket(): void {
  if (socket) {
    socket.io.opts.reconnection = false;
    socket.disconnect();
    socket = null;
  }
}

/** 是否已连接 */
export function isSocketConnected(): boolean {
  return !!socket?.connected;
}

/** 发送消息（带 5s ack 超时） */
export function sendMessage(payload: SendMessagePayload): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('未连接到聊天服务'));
      return;
    }
    socket.timeout(5000).emit(
      'send_message',
      payload,
      (err: Error | null, ack: { status: string; messageId: string }) => {
        if (err) {
          reject(new Error('发送超时，请重试'));
        } else if (ack?.messageId) {
          resolve(ack.messageId);
        } else {
          reject(new Error('发送失败'));
        }
      },
    );
  });
}

/** 标记会话已读 */
export function markConversationRead(convId: string): Promise<void> {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve();
      return;
    }
    socket.timeout(3000).emit('mark_read', { conversationId: convId }, () => {
      resolve();
    });
  });
}

// ---- 事件监听注册与注销 ----
export function onMessage(fn: Listener<ChatMessage>): () => void {
  listeners.message.push(fn);
  debugLog(`onMessage registered, total=${listeners.message.length}`);
  updateGlobalDebug();
  return () => offMessage(fn);
}

export function offMessage(fn: Listener<ChatMessage>): void {
  const idx = listeners.message.indexOf(fn);
  if (idx >= 0) {
    listeners.message.splice(idx, 1);
    debugLog(`offMessage removed, total=${listeners.message.length}`);
  }
  updateGlobalDebug();
}

export function onOfflineMessages(fn: Listener<ChatMessage[]>): () => void {
  listeners.offline.push(fn);
  debugLog(`onOfflineMessages registered, total=${listeners.offline.length}`);
  updateGlobalDebug();
  return () => offOfflineMessages(fn);
}

export function offOfflineMessages(fn: Listener<ChatMessage[]>): void {
  const idx = listeners.offline.indexOf(fn);
  if (idx >= 0) {
    listeners.offline.splice(idx, 1);
    debugLog(`offOfflineMessages removed, total=${listeners.offline.length}`);
  }
  updateGlobalDebug();
}

export function onMessageRead(fn: Listener<MessageReadPayload>): () => void {
  listeners.read.push(fn);
  debugLog(`onMessageRead registered, total=${listeners.read.length}`);
  updateGlobalDebug();
  return () => offMessageRead(fn);
}

export function offMessageRead(fn: Listener<MessageReadPayload>): void {
  const idx = listeners.read.indexOf(fn);
  if (idx >= 0) {
    listeners.read.splice(idx, 1);
    debugLog(`offMessageRead removed, total=${listeners.read.length}`);
  }
  updateGlobalDebug();
}

export function onKicked(fn: Listener<void>): () => void {
  listeners.kicked.push(fn);
  debugLog(`onKicked registered, total=${listeners.kicked.length}`);
  updateGlobalDebug();
  return () => offKicked(fn);
}

export function offKicked(fn: Listener<void>): void {
  const idx = listeners.kicked.indexOf(fn);
  if (idx >= 0) {
    listeners.kicked.splice(idx, 1);
    debugLog(`offKicked removed, total=${listeners.kicked.length}`);
  }
  updateGlobalDebug();
}

export function onConnectionChange(fn: Listener<boolean>): () => void {
  listeners.connection.push(fn);
  debugLog(`onConnectionChange registered, total=${listeners.connection.length}`);
  updateGlobalDebug();
  return () => offConnectionChange(fn);
}

export function offConnectionChange(fn: Listener<boolean>): void {
  const idx = listeners.connection.indexOf(fn);
  if (idx >= 0) {
    listeners.connection.splice(idx, 1);
    debugLog(`offConnectionChange removed, total=${listeners.connection.length}`);
  }
  updateGlobalDebug();
}

/** 清除所有监听器（用于 store 重新初始化或登出时）*/
export function removeAllListeners(): void {
  debugLog('removeAllListeners called');
  listeners.message.length = 0;
  listeners.offline.length = 0;
  listeners.read.length = 0;
  listeners.kicked.length = 0;
  listeners.connection.length = 0;
  updateGlobalDebug();
}

// 将调试函数暴露到全局，供自动化测试使用
try {
  if (typeof getApp !== 'undefined') {
    const app = getApp() as Record<string, unknown>;
    if (app) {
      app.getListenerCounts = getListenerCounts;
      app.setSocketDebug = setSocketDebug;
      app.getConnectionStatus = () => ({
        connected: socket?.connected ?? false,
        connecting,
      });
    }
  }
} catch (error) {
  // 在非小程序环境下，getApp 可能不存在，这是正常的
  // console.warn('[socket] 非小程序环境，跳过调试函数注册', error);
}
