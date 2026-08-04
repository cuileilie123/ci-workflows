<template>
  <view class="chat-room">
    <!-- 消息滚动区 -->
    <scroll-view
      class="msg-scroll"
      scroll-y
      :scroll-top="scrollTop"
      :scroll-with-animation="true"
      :lower-threshold="200"
      @scrolltolower="onScrollLower"
    >
      <!-- 加载更早历史 -->
      <view v-if="loadingHistory" class="loading-history">
        <text class="loading-text">加载中...</text>
      </view>
      <view v-else-if="!hasMore && messages.length > 0" class="no-more">
        <text class="no-more-text">没有更多了</text>
      </view>

      <!-- 消息气泡 -->
      <view
        v-for="msg in messages"
        :key="msg._id || (msg.clientMessageId as string)"
        class="msg-row"
        :class="{ 'row-mine': isMine(msg.senderId) }"
      >
        <!-- 对方头像 -->
        <view v-if="!isMine(msg.senderId)" class="avatar-side">
          <image v-if="peerAvatar" class="avatar" :src="peerAvatar" mode="aspectFill" />
          <view v-else class="avatar avatar-ph">
            <text class="avatar-ph-text">{{ peerInitial }}</text>
          </view>
        </view>

        <!-- 气泡 -->
        <view class="bubble-wrap">
          <!-- 文本 -->
          <view
            v-if="msg.type === 'TEXT'"
            class="bubble bubble-text"
            :class="{ 'bubble-mine': isMine(msg.senderId) }"
          >
            <text class="bubble-text-content">{{ msg.content }}</text>
          </view>
          <!-- 图片 -->
          <image
            v-else-if="msg.type === 'IMAGE' && msg.metadata?.url"
            class="bubble-img"
            :src="resolveUrl(msg.metadata.url)"
            mode="aspectFill"
            @click="previewImage(msg.metadata!.url!)"
          />
          <!-- 位置 -->
          <view
            v-else-if="msg.type === 'LOCATION'"
            class="bubble bubble-location"
            :class="{ 'bubble-mine': isMine(msg.senderId) }"
            @click="openLocation(msg)"
          >
            <text class="loc-title">📍 位置信息</text>
            <text v-if="msg.metadata?.address" class="loc-addr">{{ msg.metadata.address }}</text>
          </view>
          <!-- 系统消息 -->
          <view
            v-else-if="msg.type === 'SYSTEM'"
            class="bubble bubble-system"
          >
            <text class="system-text">{{ msg.content }}</text>
          </view>
          <!-- 未知类型 -->
          <view v-else class="bubble bubble-text">
            <text class="bubble-text-content">[不支持的消息类型]</text>
          </view>

          <!-- 发送状态 -->
          <view class="bubble-status" v-if="isMine(msg.senderId) && msg._id !== 'pending_'">
            <text
              class="status-text"
              :class="getSendStatusClass(msg)"
            >
              {{ getSendStatusText(msg) }}
            </text>
          </view>
          <!-- 时间 -->
          <text class="msg-time">{{ formatTime(msg.createdAt) }}</text>
        </view>

        <!-- 我方头像（占位，保持对齐） -->
        <view v-if="isMine(msg.senderId)" class="avatar-side" />
      </view>
    </scroll-view>

    <!-- 底部输入栏 -->
    <view class="input-bar" :style="{ paddingBottom: safeBottom + 'px' }">
      <view
        class="icon-btn"
        @tap="onPickImage"
        :disabled="sending"
      >
        <text class="icon-emoji">📷</text>
      </view>
      <view class="input-wrap">
        <input
          class="msg-input"
          v-model="inputText"
          placeholder="输入消息..."
          placeholder-class="input-ph"
          confirm-type="send"
          :disabled="sending"
          @confirm="onSendText"
        />
      </view>
      <button
        class="send-btn"
        size="mini"
        :disabled="!canSendText()"
        @tap="onSendText"
      >
        发送
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { onLoad, onReachBottom, onShow, onUnload } from '@dcloudio/uni-app';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { chatApi } from '@/api/chat';
import type { ChatMessage, MessageType } from '@/types/chat';

const chatStore = useChatStore();
const userStore = useUserStore();

// ---- 路由参数 ----
const peerId = ref('');
const peerNickname = ref('邻居');
const peerAvatar = ref('');

const convId = computed(() => chatStore.buildConversationId(peerId.value));
const peerInitial = computed(() => (peerNickname.value || '邻').slice(0, 1));

// 导航栏标题
onLoad((opts) => {
  const o = opts as {
    peerId?: string;
    peerNickname?: string;
    peerAvatar?: string;
  } | undefined;
  if (o?.peerId) peerId.value = o.peerId;
  if (o?.peerNickname) peerNickname.value = decodeURIComponent(o.peerNickname);
  if (o?.peerAvatar) peerAvatar.value = decodeURIComponent(o.peerAvatar);

  uni.setNavigationBarTitle({ title: peerNickname.value });
});

// ---- 消息列表 ----
const messages = ref<ChatMessage[]>([]);
const loadingHistory = ref(false);
const hasMore = ref(true);
const sending = ref(false);
const inputText = ref('');
const scrollTop = ref(0);
const safeBottom = ref(0);

onMounted(() => {
  // 读取安全区域
  try {
    const sys = uni.getSystemInfoSync();
    safeBottom.value = sys.safeAreaInsets?.bottom ?? 0;
  } catch {
    safeBottom.value = 0;
  }
});

async function init(): Promise<void> {
  // 确保 WS 连接和监听（store.init 有 initialized 守卫，幂等）
  chatStore.init();
  chatStore.connect();

  // 加载历史消息（首次加载）
  await loadHistory(true);

  // 注册实时消息监听（仅本页）
  onRealtimeMessage = (msg: ChatMessage) => {
    if (msg.conversationId !== convId.value) return;
    messages.value.push(msg);
    scrollToBottom();
    if (msg.senderId !== userStore.userInfo?.id) {
      // 对方消息，debounce 2s 标记已读（避免高频消息导致 mark_read 调用过载）
      scheduleMarkRead();
    }
  };
  chatStore.registerMessageHandler(onRealtimeMessage);

  // 标记会话已读
  if (convId.value) {
    await chatStore.markRead(convId.value);
  }
}

let onRealtimeMessage: ((msg: ChatMessage) => void) | null = null;
let lastLoadAt = 0;
let markReadTimer: ReturnType<typeof setTimeout> | null = null;

/** debounce 标记已读：2s 内多次收到消息只调用一次 mark_read，降低服务端 updateMany 压力 */
function scheduleMarkRead(): void {
  if (markReadTimer) clearTimeout(markReadTimer);
  markReadTimer = setTimeout(() => {
    chatStore.markRead(convId.value).catch(() => {});
    markReadTimer = null;
  }, 2000);
}

onLoad((opts) => {
  const o = opts as {
    peerId?: string;
    peerNickname?: string;
    peerAvatar?: string;
  } | undefined;
  if (o?.peerId) peerId.value = o.peerId;
  if (o?.peerNickname) peerNickname.value = decodeURIComponent(o.peerNickname);
  if (o?.peerAvatar) peerAvatar.value = decodeURIComponent(o.peerAvatar);

  uni.setNavigationBarTitle({ title: peerNickname.value });

  // onLoad 只触发一次，在此完成初始化
  if (peerId.value) {
    init();
    lastLoadAt = Date.now();
  }
});

onShow(() => {
  if (!peerId.value) return;
  // 仅当距上次加载超过 30s 时才刷新（避免 onShow 高频触发导致重载）
  const now = Date.now();
  if (now - lastLoadAt > 30_000) {
    // 增量刷新：重新连接 WS（如需）+ 标记已读
    chatStore.connect();
    if (convId.value) {
      chatStore.markRead(convId.value).catch(() => {});
    }
    lastLoadAt = now;
  }
});

onUnload(() => {
  // 卸载前立即触发 pending 的已读标记，保证状态及时同步
  if (markReadTimer) {
    clearTimeout(markReadTimer);
    chatStore.markRead(convId.value).catch(() => {});
    markReadTimer = null;
  }
  chatStore.unregisterMessageHandler();
  onRealtimeMessage = null;
});

// ---- 加载历史（游标分页）----
async function loadHistory(reset = false): Promise<void> {
  if (!convId.value) return;
  if (reset) {
    messages.value = [];
    hasMore.value = true;
  }
  if (loadingHistory.value || !hasMore.value) return;
  loadingHistory.value = true;
  try {
    const earliest = reset ? undefined : messages.value[0]?.createdAt;
    const result = await chatApi.getMessages(convId.value, {
      before: earliest,
      limit: 20,
    });
    const list = result.list ?? [];
    // 游标分页倒序返回，需要插入列表头部
    const ordered = [...list].reverse();
    if (reset) {
      messages.value = ordered;
    } else {
      messages.value = [...ordered, ...messages.value];
    }
    hasMore.value = result.hasMore;
    if (reset) nextTick(() => scrollToBottom());
  } catch {
    // 静默
  } finally {
    loadingHistory.value = false;
  }
}

onReachBottom(() => {
  // 反向：onReachBottom 用于加载更早历史（需要向上滚到顶），暂用 scrolltolower
});

function onScrollLower(): void {
  // scroll-view 触底：加载更早消息（模拟"上滑加载更多"）
  // 注：scroll-y 列表触底是加载新消息，此处改为"距顶一定距离"加载历史
  loadHistory();
}

function scrollToBottom(): void {
  // 用一个足够大的值滚动到底
  scrollTop.value = 999999;
  nextTick(() => {
    scrollTop.value = 999999 + 1;
  });
}

// ---- 发送消息 ----
function isMine(senderId: string): boolean {
  return senderId === userStore.userInfo?.id;
}

function canSendText(): boolean {
  return !!inputText.value.trim() && !sending.value;
}

function genClientId(): string {
  return `cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function onSendText(): Promise<void> {
  const text = inputText.value.trim();
  if (!text || sending.value) return;
  await doSend('TEXT', text);
  inputText.value = '';
}

async function doSend(
  type: MessageType,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (!userStore.userInfo?.id || !peerId.value) return;
  sending.value = true;

  const clientMessageId = genClientId();

  // 乐观插入占位消息
  const optimistic: ChatMessage = {
    _id: clientMessageId,
    conversationId: convId.value,
    senderId: userStore.userInfo.id,
    receiverId: peerId.value,
    type,
    content,
    metadata: metadata ?? null,
    readAt: null,
    clientMessageId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  messages.value.push(optimistic);
  scrollToBottom();

  try {
    const messageId = await chatStore.sendMessage({
      receiverId: peerId.value,
      type,
      content,
      metadata,
      clientMessageId,
    });
    // 替换占位的 _id
    const idx = messages.value.findIndex((m) => m.clientMessageId === clientMessageId);
    if (idx >= 0) {
      messages.value[idx] = { ...messages.value[idx], _id: messageId };
    }
  } catch (e) {
    // 发送失败：标记为失败状态
    const idx = messages.value.findIndex((m) => m.clientMessageId === clientMessageId);
    if (idx >= 0) {
      messages.value[idx] = {
        ...messages.value[idx],
        _id: `failed_${clientMessageId}`,
      };
    }
    uni.showToast({ title: (e as Error).message || '发送失败', icon: 'none' });
  } finally {
    sending.value = false;
  }
}

// ---- 图片发送 ----
async function onPickImage(): Promise<void> {
  try {
    const res = await new Promise<{
      tempFiles: Array<{ tempFilePath: string; size: number }>;
    }>((resolve, reject) => {
      uni.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: resolve,
        fail: reject,
      });
    });
    const tempFile = res.tempFiles?.[0];
    if (!tempFile) return;

    // 先上传
    const uploadResult = await chatApi.upload(tempFile.tempFilePath);
    const url = uploadResult.url;

    await doSend('IMAGE', '[图片]', { url });
  } catch {
    // 用户取消静默
  }
}

// ---- 辅助 ----
function resolveUrl(u: string): string {
  if (!u) return '';
  if (u.startsWith('http')) return u;
  const base = import.meta.env.VITE_API_BASE_URL as string;
  return `${base}${u}`;
}

function previewImage(url: string): void {
  const full = resolveUrl(url);
  const imgs = messages.value
    .filter((m) => m.type === 'IMAGE' && m.metadata?.url)
    .map((m) => resolveUrl(m.metadata!.url!));
  uni.previewImage({ urls: imgs.length ? imgs : [full], current: full });
}

function openLocation(msg: ChatMessage): void {
  if (msg.type !== 'LOCATION' || !msg.metadata) return;
  uni.openLocation({
    latitude: msg.metadata.lat ?? 0,
    longitude: msg.metadata.lng ?? 0,
    address: msg.metadata.address ?? '',
    fail: () => uni.showToast({ title: '打开地图失败', icon: 'none' }),
  });
}

function getSendStatusClass(msg: ChatMessage): string {
  if (msg._id.startsWith('failed_')) return 'status-fail';
  if (msg.readAt) return 'status-read';
  return 'status-sent';
}

function getSendStatusText(msg: ChatMessage): string {
  if (msg._id.startsWith('failed_')) return '发送失败';
  if (msg.readAt) return '已读';
  return '已送达';
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  } catch {
    return '';
  }
}

// ---- 扩展 store 的消息注册（局部）----
declare module '@/store/chat' {
  interface _ChatStoreEx {
    registerMessageHandler: (fn: (msg: ChatMessage) => void) => void;
    unregisterMessageHandler: () => void;
  }
}
</script>

<style lang="scss" scoped>
.chat-room {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #f0f0f0;
}

.msg-scroll {
  flex: 1;
  padding: 20rpx 24rpx;
  box-sizing: border-box;
}

.loading-history, .no-more {
  display: flex;
  justify-content: center;
  padding: 16rpx 0;
}

.loading-text, .no-more-text {
  font-size: 22rpx;
  color: #aaa;
}

.msg-row {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  margin-bottom: 28rpx;

  &.row-mine {
    flex-direction: row-reverse;
  }
}

.avatar-side {
  width: 72rpx;
  flex-shrink: 0;
}

.avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
}

.avatar-ph {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background-color: #4caf50;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-ph-text {
  color: #fff;
  font-size: 28rpx;
}

.bubble-wrap {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  max-width: 500rpx;
  min-width: 100rpx;
}

.bubble {
  padding: 20rpx 24rpx;
  border-radius: 20rpx;
  position: relative;
  word-break: break-word;
}

.bubble-text {
  background-color: #fff;
  color: #222;
  font-size: 30rpx;
  line-height: 1.5;
}

.bubble-mine {
  background-color: #95ec69;
}

.bubble-text-content {
  font-size: 30rpx;
  color: #222;
  line-height: 1.5;
}

.bubble-img {
  width: 280rpx;
  height: 280rpx;
  border-radius: 16rpx;
  object-fit: cover;
}

.bubble-location {
  background-color: #fff;
  min-width: 240rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.loc-title {
  font-size: 28rpx;
  color: #333;
  font-weight: 500;
}

.loc-addr {
  font-size: 24rpx;
  color: #888;
}

.bubble-system {
  background-color: transparent;
  align-self: center;
  padding: 8rpx 16rpx;
}

.system-text {
  font-size: 24rpx;
  color: #999;
  background-color: #e0e0e0;
  padding: 6rpx 16rpx;
  border-radius: 16rpx;
}

.bubble-status {
  align-self: flex-end;
}

.status-text {
  font-size: 20rpx;
}

.status-sent {
  color: #bbb;
}

.status-read {
  color: #4caf50;
}

.status-fail {
  color: #ff3b30;
}

.msg-time {
  font-size: 20rpx;
  color: #bbb;
  align-self: flex-end;
}

/* ---- 输入栏 ---- */
.input-bar {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 20rpx;
  background-color: #fafafa;
  border-top: 1rpx solid #e8e8e8;
}

.icon-btn {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &:active {
    opacity: 0.6;
  }
}

.icon-emoji {
  font-size: 48rpx;
}

.input-wrap {
  flex: 1;
  background-color: #fff;
  border-radius: 36rpx;
  padding: 0 24rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  border: 1rpx solid #e0e0e0;
}

.msg-input {
  flex: 1;
  font-size: 28rpx;
  color: #222;
}

.input-ph {
  color: #bbb;
}

.send-btn {
  background-color: #4caf50;
  color: #fff;
  border-radius: 36rpx;
  height: 72rpx;
  line-height: 72rpx;
  padding: 0 28rpx;
  font-size: 28rpx;
  margin: 0;

  &::after {
    border: none;
  }

  &[disabled] {
    background-color: #c8e6c9;
    color: #fff;
  }
}
</style>
