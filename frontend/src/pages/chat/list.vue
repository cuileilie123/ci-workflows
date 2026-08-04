<template>
  <view class="chat-list-page">
    <!-- 加载中 -->
    <view v-if="loading && !list.length" class="state state-loading">
      <text class="state-text">加载中...</text>
    </view>

    <!-- 空状态 -->
    <view v-else-if="!list.length" class="state state-empty">
      <view class="empty-icon" />
      <text class="state-text">暂无消息</text>
      <text class="state-sub">接单或被接单后，可与对方沟通任务细节</text>
    </view>

    <!-- 会话列表 -->
    <view v-else class="conv-list">
      <view
        v-for="conv in list"
        :key="conv.conversationId"
        class="conv-item"
        @tap="onTapConv(conv)"
      >
        <view class="avatar-wrap">
          <image v-if="conv.peerAvatar" class="avatar" :src="conv.peerAvatar" mode="aspectFill" />
          <view v-else class="avatar avatar-ph">
            <text class="avatar-ph-text">{{ conv.peerNickname.slice(0, 1) }}</text>
          </view>
          <view v-if="conv.unreadCount > 0" class="unread-badge">
            <text class="badge-text">{{ conv.unreadCount > 99 ? '99+' : conv.unreadCount }}</text>
          </view>
        </view>
        <view class="conv-info">
          <view class="top-row">
            <text class="nickname">{{ conv.peerNickname }}</text>
            <text v-if="conv.lastMessage" class="time">{{ formatTime(conv.lastMessage.createdAt) }}</text>
          </view>
          <view class="bottom-row">
            <text class="last-msg" :class="{ 'unread-text': conv.unreadCount > 0 }">
              {{ lastMsgPreview(conv) }}
            </text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { computed, onMounted, ref } from 'vue';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import type { ConversationSummary } from '@/types/chat';

const chatStore = useChatStore();
const userStore = useUserStore();

const loading = ref(false);
const list = computed(() => chatStore.conversations);

let lastLoadAt = 0;

async function load(): Promise<void> {
  if (!userStore.isLoggedIn) return;
  loading.value = true;
  try {
    // 确保 WS 连接（onMessage 监听在 store.init 中已注册）
    chatStore.init();
    chatStore.connect();
    await chatStore.loadConversations();
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
  lastLoadAt = Date.now();
});

onShow(() => {
  // 从聊天室返回时，刷新会话列表以查看最新消息
  const now = Date.now();
  if (now - lastLoadAt > 5000) {
    load();
    lastLoadAt = now;
  }
});

onPullDownRefresh(async () => {
  await load();
  lastLoadAt = Date.now();
  uni.stopPullDownRefresh();
});

function lastMsgPreview(conv: ConversationSummary): string {
  if (!conv.lastMessage) return '';
  const t = conv.lastMessage.type;
  switch (t) {
    case 'TEXT': return conv.lastMessage.content;
    case 'IMAGE': return '[图片]';
    case 'VOICE': return '[语音]';
    case 'LOCATION': return '[位置]';
    case 'SYSTEM': return '[系统消息]';
    default: return '';
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}天前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function onTapConv(conv: ConversationSummary): void {
  uni.navigateTo({
    url: `/pages/chat/chat?peerId=${conv.peerId}&peerNickname=${encodeURIComponent(conv.peerNickname)}&peerAvatar=${encodeURIComponent(conv.peerAvatar ?? '')}`,
  });
}
</script>

<style lang="scss" scoped>
.chat-list-page {
  min-height: 100vh;
  background-color: #f8f8f8;
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 200rpx;
  gap: 16rpx;
}

.empty-icon {
  width: 160rpx;
  height: 160rpx;
  background-color: #e8e8e8;
  border-radius: 50%;
  margin-bottom: 16rpx;
  position: relative;

  &::after {
    content: '💬';
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 72rpx;
    opacity: 0.5;
  }
}

.state-text {
  font-size: 28rpx;
  color: #999;
}

.state-sub {
  font-size: 24rpx;
  color: #bbb;
}

.conv-list {
  background-color: #fff;
}

.conv-item {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 28rpx 32rpx;
  border-bottom: 1rpx solid #f0f0f0;
  position: relative;

  &:active {
    background-color: #fafafa;
  }
}

.avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
}

.avatar-ph {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background-color: #4caf50;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-ph-text {
  color: #fff;
  font-size: 36rpx;
}

.unread-badge {
  position: absolute;
  top: -8rpx;
  right: -8rpx;
  min-width: 36rpx;
  height: 36rpx;
  line-height: 36rpx;
  padding: 0 10rpx;
  background-color: #ff3b30;
  color: #fff;
  font-size: 22rpx;
  border-radius: 18rpx;
  text-align: center;
  box-sizing: border-box;
}

.badge-text {
  color: #fff;
}

.conv-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nickname {
  font-size: 30rpx;
  color: #222;
  font-weight: 500;
}

.time {
  font-size: 22rpx;
  color: #bbb;
  flex-shrink: 0;
}

.bottom-row {
  min-width: 0;
}

.last-msg {
  display: block;
  font-size: 26rpx;
  color: #999;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.unread-text {
  color: #333;
  font-weight: 500;
}
</style>
