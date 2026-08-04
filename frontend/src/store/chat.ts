import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { chatApi } from '@/api/chat';
import {
  connectSocket,
  disconnectSocket,
  isSocketConnected,
  markConversationRead,
  onConnectionChange,
  onKicked,
  onMessage,
  onMessageRead,
  onOfflineMessages,
  removeAllListeners,
  sendMessage as wsSendMessage,
} from '@/utils/socket';
import { useUserStore } from '@/store/user';
import type {
  ChatMessage,
  ConversationSummary,
  SendMessagePayload,
} from '@/types/chat';

export const useChatStore = defineStore('chat', () => {
  const userStore = useUserStore();

  const conversations = ref<ConversationSummary[]>([]);
  const connected = ref(false);
  const initialized = ref(false);

  /** 未读消息总数 */
  const unreadTotal = computed(() =>
    conversations.value.reduce((sum, c) => sum + c.unreadCount, 0),
  );

  /** 构建确定性会话 ID（与 BFF 一致） */
  function buildConversationId(peerId: string): string {
    const me = userStore.userInfo?.id;
    if (!me) return '';
    const a = BigInt(me);
    const b = BigInt(peerId);
    return a < b ? `${a}_${b}` : `${b}_${a}`;
  }

  /** 初始化 WebSocket 连接 + 注册事件监听（App.vue 启动时调用一次） */
  let cleanupFns: Array<() => void> = [];

  function init(): void {
    if (initialized.value) return;
    initialized.value = true;

    cleanupFns.push(onMessage((msg: ChatMessage) => {
      globalOnMessage(msg);
    }));

    cleanupFns.push(onOfflineMessages((msgs: ChatMessage[]) => {
      msgs.forEach((msg) => upsertConversation(msg));
    }));

    cleanupFns.push(onMessageRead((payload) => {
      const conv = conversations.value.find(
        (c) => c.conversationId === payload.conversationId,
      );
      if (conv) {
        conv.unreadCount = 0;
      }
    }));

    cleanupFns.push(onConnectionChange((isConnected) => {
      connected.value = isConnected;
    }));

    cleanupFns.push(onKicked(() => {
      uni.showToast({ title: '另一设备登录，已断开', icon: 'none' });
      userStore.clearLocal();
      uni.reLaunch({ url: '/pages/auth/login' });
    }));
  }

  /** 重置所有状态（登出时调用）*/
  function reset(): void {
    cleanupFns.forEach((fn) => fn());
    cleanupFns = [];
    removeAllListeners();
    disconnectSocket();
    conversations.value = [];
    connected.value = false;
    initialized.value = false;
    chatPageHandler = null;
  }

  /** 连接 WebSocket */
  function connect(): void {
    if (!userStore.isLoggedIn) return;
    try {
      connectSocket();
    } catch (e) {
      // 未登录时静默
    }
  }

  /** 断开连接 */
  function disconnect(): void {
    disconnectSocket();
    connected.value = false;
  }

  /** 拉取会话列表 */
  async function loadConversations(): Promise<void> {
    try {
      conversations.value = await chatApi.getConversations();
    } catch {
      // 静默
    }
  }

  /** 新消息到达时更新会话列表 */
  function upsertConversation(msg: ChatMessage): void {
    const convId = msg.conversationId;
    const me = userStore.userInfo?.id;
    const peerId = msg.senderId === me ? msg.receiverId : msg.senderId;
    const isMine = msg.senderId === me;

    let conv = conversations.value.find((c) => c.conversationId === convId);
    if (!conv) {
      conv = {
        conversationId: convId,
        peerId,
        peerNickname: '邻居',
        peerAvatar: null,
        lastMessage: msg,
        unreadCount: 0,
      };
      conversations.value.unshift(conv);
    } else {
      conv.lastMessage = msg;
      // 移到顶部
      const idx = conversations.value.indexOf(conv);
      if (idx > 0) {
        conversations.value.splice(idx, 1);
        conversations.value.unshift(conv);
      }
    }
    // 非自己发的消息且未读 → 未读数 +1
    if (!isMine && !msg.readAt) {
      conv.unreadCount++;
    }
  }

  /** 发送消息 */
  async function sendMessage(payload: SendMessagePayload): Promise<string> {
    return wsSendMessage(payload);
  }

  /** 标记会话已读（WS + REST 双通道） */
  async function markRead(convId: string): Promise<void> {
    const conv = conversations.value.find(
      (c) => c.conversationId === convId,
    );
    if (conv) conv.unreadCount = 0;

    if (isSocketConnected()) {
      await markConversationRead(convId);
    } else {
      await chatApi.markRead(convId).catch(() => {});
    }
  }

  // ---- 单聊页面级消息处理器（当前聊天室独立处理实时到达消息）----
  let chatPageHandler: ((msg: ChatMessage) => void) | null = null;

  function registerMessageHandler(fn: (msg: ChatMessage) => void): void {
    chatPageHandler = fn;
  }

  function unregisterMessageHandler(): void {
    chatPageHandler = null;
  }

  // 全局 onMessage 分发：优先交给 chat page 处理（避免重复写 messages）
  function globalOnMessage(msg: ChatMessage): void {
    if (chatPageHandler) {
      chatPageHandler(msg);
      // 同步更新会话列表的未读/最后一条（对方消息在 chat page 立即已读）
      const isMine = msg.senderId === userStore.userInfo?.id;
      if (isMine) upsertConversation(msg);
    } else {
      upsertConversation(msg);
    }
  }

  return {
    conversations,
    connected,
    unreadTotal,
    init,
    reset,
    connect,
    disconnect,
    loadConversations,
    buildConversationId,
    sendMessage,
    markRead,
    globalOnMessage,
    registerMessageHandler,
    unregisterMessageHandler,
  };
});
