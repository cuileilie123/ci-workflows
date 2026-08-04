<template>
  <view class="detail-page">
    <!-- 加载中 -->
    <view v-if="loading && !task" class="state state-loading">
      <text class="state-text">加载中...</text>
    </view>

    <!-- 加载失败 -->
    <view v-else-if="error && !task" class="state state-error">
      <text class="state-text">{{ error }}</text>
      <button class="state-btn" size="mini" @click="loadDetail">重新加载</button>
    </view>

    <!-- 详情内容 -->
    <view v-else-if="task" class="content">
      <!-- 标题 + 价格 + 状态 -->
      <view class="header-card">
        <view class="title-row">
          <text class="title">{{ task.title }}</text>
          <text class="status-tag" :style="{ backgroundColor: statusConfig.color }">{{ statusConfig.label }}</text>
        </view>
        <view class="price-row">
          <text class="price">¥{{ task.price }}</text>
          <text class="category-tag">{{ categoryLabel }}</text>
        </view>
      </view>

      <!-- 发布者信息 -->
      <view class="publisher-card">
        <image v-if="task.publisher?.avatar" class="avatar" :src="task.publisher.avatar" mode="aspectFill" />
        <view v-else class="avatar avatar-ph">
          <text class="avatar-ph-text">{{ publisherInitial }}</text>
        </view>
        <view class="publisher-info">
          <text class="nickname">{{ task.publisher?.nickname || '邻居' }}</text>
          <text class="publish-time">{{ relativeTime }}</text>
        </view>
        <view class="view-count">
          <text class="view-text">{{ task.viewCount }} 次浏览</text>
        </view>
      </view>

      <!-- 任务描述 -->
      <view class="desc-card">
        <text class="card-label">任务描述</text>
        <text class="desc-text">{{ task.description }}</text>
      </view>

      <!-- 图片展示 -->
      <view v-if="task.images && task.images.length" class="images-card">
        <text class="card-label">任务图片</text>
        <view class="img-grid">
          <image
            v-for="(img, idx) in task.images"
            :key="idx"
            class="img"
            :src="img"
            mode="aspectFill"
            @click="onPreviewImage(idx)"
          />
        </view>
      </view>

      <!-- 位置卡片 -->
      <view v-if="task.address" class="location-card" @click="onOpenLocation">
        <view class="loc-icon-wrap">
          <text class="loc-icon">📍</text>
        </view>
        <view class="loc-info">
          <text class="loc-label">任务位置</text>
          <text class="loc-address">{{ task.address }}</text>
        </view>
        <text class="loc-arrow">›</text>
      </view>

      <!-- 状态时间线 -->
      <view class="timeline-card">
        <text class="card-label">任务进度</text>
        <view class="timeline">
          <view
            v-for="(node, idx) in timeline"
            :key="idx"
            class="tl-node"
            :class="{ 'tl-done': node.done, 'tl-last': idx === timeline.length - 1 }"
          >
            <view class="tl-dot" :class="{ 'dot-done': node.done }">
              <text v-if="node.done" class="dot-check">✓</text>
            </view>
            <view class="tl-content">
              <text class="tl-title" :class="{ 'tl-title-done': node.done }">{{ node.title }}</text>
              <text v-if="node.desc" class="tl-desc">{{ node.desc }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- 底部操作栏 -->
    <view v-if="task && actions.length" class="action-bar">
      <button
        v-for="act in actions"
        :key="act.key"
        class="action-btn"
        :class="act.cls"
        :disabled="!!acting"
        @click="onAction(act)"
      >
        {{ acting && acting === act.key ? '处理中...' : act.label }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { taskApi, paymentApi } from '@/api';
import { payForTask } from '@/utils/payment';
import { useUserStore } from '@/store/user';
import { TASK_CATEGORY_LABELS } from '@/types';
import type { Task, TaskStatus } from '@/types';

const userStore = useUserStore();

const task = ref<Task | null>(null);
const loading = ref(false);
const error = ref('');
const acting = ref(''); // 正在处理的 action key

const statusConfigMap: Record<TaskStatus, { label: string; color: string }> = {
  OPEN: { label: '待接单', color: '#FF9500' },
  ASSIGNED: { label: '待支付', color: '#007AFF' },
  IN_PROGRESS: { label: '进行中', color: '#34C759' },
  COMPLETED: { label: '已完成', color: '#8E8E93' },
  CANCELLED: { label: '已取消', color: '#8E8E93' },
};

const statusConfig = computed(() => statusConfigMap[task.value?.status ?? 'OPEN']);
const categoryLabel = computed(() => {
  const cat = task.value?.category;
  return cat ? TASK_CATEGORY_LABELS[cat] : '';
});

const isPublisher = computed(() => {
  const me = userStore.userInfo?.id;
  return !!(me && task.value && String(task.value.publisherId) === String(me));
});

const isHelper = computed(() => {
  const me = userStore.userInfo?.id;
  return !!(me && task.value?.helperId && String(task.value.helperId) === String(me));
});

const publisherInitial = computed(() => {
  const n = task.value?.publisher?.nickname || '邻';
  return n.slice(0, 1);
});

const relativeTime = computed(() => {
  if (!task.value?.createdAt) return '';
  const diff = Date.now() - new Date(task.value.createdAt).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(task.value.createdAt).toLocaleDateString();
});

// 时间线节点
const timeline = computed(() => {
  if (!task.value) return [];
  const s = task.value.status;
  return [
    { title: '发布任务', desc: relativeTime.value, done: true },
    { title: '接单', desc: s === 'OPEN' ? '等待接单' : '已接单', done: s !== 'OPEN' && s !== 'CANCELLED' },
    { title: '支付', desc: ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'].includes(s) ? '已支付' : '待支付', done: ['IN_PROGRESS', 'COMPLETED'].includes(s) },
    { title: '开始服务', desc: ['IN_PROGRESS', 'COMPLETED'].includes(s) ? '进行中' : '待开始', done: ['IN_PROGRESS', 'COMPLETED'].includes(s) },
    { title: '完成', desc: s === 'COMPLETED' ? '已完成' : '待完成', done: s === 'COMPLETED' },
  ];
});

// 底部操作按钮（按角色 + 状态）
interface ActionItem {
  key: string;
  label: string;
  cls: string;
}

const actions = computed<ActionItem[]>(() => {
  if (!task.value) return [];
  const s = task.value.status;
  const list: ActionItem[] = [];
  const canContact = isPublisher.value || isHelper.value;
  // 联系TA（相关方可见）
  if (canContact && s !== 'CANCELLED' && s !== 'COMPLETED') {
    list.push({ key: 'contact', label: '联系TA', cls: 'btn-secondary' });
  }
  if (s === 'OPEN') {
    if (isPublisher.value) {
      list.push({ key: 'cancel', label: '取消任务', cls: 'btn-danger' });
    } else {
      list.push({ key: 'accept', label: '我要接单', cls: 'btn-primary' });
    }
  } else if (s === 'ASSIGNED') {
    if (isPublisher.value) {
      list.push({ key: 'pay', label: '去支付', cls: 'btn-primary' });
    }
    if (isHelper.value) {
      list.push({ key: 'waitPay', label: '等待支付', cls: 'btn-secondary' });
    }
  } else if (s === 'IN_PROGRESS') {
    if (isPublisher.value) {
      list.push({ key: 'complete', label: '确认完成', cls: 'btn-primary' });
      list.push({ key: 'refund', label: '申请退款', cls: 'btn-danger' });
    }
  }
  return list;
});

let taskId = '';

async function loadDetail(): Promise<void> {
  if (!taskId) return;
  loading.value = true;
  error.value = '';
  try {
    task.value = await taskApi.detail(taskId);
  } catch (e) {
    error.value = (e as Error).message || '加载失败';
  } finally {
    loading.value = false;
  }
}

onShow(() => {
  loadDetail();
});

// ---- 操作处理 ----
async function onAction(act: ActionItem): Promise<void> {
  if (acting.value) return;
  const map: Record<string, () => Promise<void>> = {
    accept: doAccept,
    pay: doPay,
    waitPay: doWaitPay,
    complete: doComplete,
    refund: doRefund,
    cancel: doCancel,
    contact: doContact,
  };
  const fn = map[act.key];
  if (!fn) return;
  acting.value = act.key;
  try {
    await fn();
  } finally {
    acting.value = '';
  }
}

function confirm(title: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title,
      content,
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(false),
    });
  });
}

async function doAccept(): Promise<void> {
  const ok = await confirm('确认接单', '接单后需按要求完成任务，确定接单吗？');
  if (!ok) return;
  try {
    await taskApi.accept(taskId);
    uni.showToast({ title: '接单成功', icon: 'success' });
    await loadDetail();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '接单失败', icon: 'none' });
  }
}

async function doPay(): Promise<void> {
  const ok = await confirm('确认支付', `确认支付 ¥${task.value?.price} 接单报酬吗？`);
  if (!ok) return;
  try {
    const orderId = await payForTask(taskId);
    if (orderId) {
      uni.showToast({ title: '支付成功', icon: 'success' });
      // 跳转到订单详情页
      uni.navigateTo({ url: `/pages/order/detail?id=${orderId}` });
    } else {
      uni.showToast({ title: '已取消支付', icon: 'none' });
    }
    await loadDetail();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '支付失败', icon: 'none' });
  }
}

async function doWaitPay(): Promise<void> {
  uni.showToast({ title: '请等待发布者支付', icon: 'none' });
}

async function doRefund(): Promise<void> {
  if (!task.value) return;
  const ok = await confirm('申请退款', '确认要申请退款吗？退款将原路返回，可能需要 1-3 个工作日。');
  if (!ok) return;
  try {
    // 简化处理：使用任务ID作为订单ID查询
    await paymentApi.refund(taskId, Number(task.value.price), '用户申请退款');
    uni.showToast({ title: '退款申请成功', icon: 'success' });
    await loadDetail();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '退款失败', icon: 'none' });
  }
}

async function doComplete(): Promise<void> {
  const ok = await confirm('确认完成', '确认任务已完成？完成后将结算报酬。');
  if (!ok) return;
  try {
    await taskApi.complete(taskId);
    uni.showToast({ title: '任务已完成', icon: 'success' });
    await loadDetail();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '操作失败', icon: 'none' });
  }
}

async function doCancel(): Promise<void> {
  const ok = await confirm('取消任务', '取消后任务将无法恢复，确定取消吗？');
  if (!ok) return;
  try {
    await taskApi.cancel(taskId);
    uni.showToast({ title: '已取消', icon: 'success' });
    await loadDetail();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '取消失败', icon: 'none' });
  }
}

async function doContact(): Promise<void> {
  if (!task.value) return;
  const me = userStore.userInfo?.id;
  const peerId = isPublisher.value ? task.value.helperId : task.value.publisherId;
  if (!peerId) {
    uni.showToast({ title: '对方尚未接单', icon: 'none' });
    return;
  }
  const peerNickname = isPublisher.value
    ? ''
    : task.value.publisher?.nickname ?? '邻居';
  const peerAvatar = isPublisher.value
    ? ''
    : task.value.publisher?.avatar ?? '';
  uni.navigateTo({
    url: `/pages/chat/chat?peerId=${peerId}&peerNickname=${encodeURIComponent(peerNickname)}&peerAvatar=${encodeURIComponent(peerAvatar)}`,
  });
}

// ---- 图片预览 ----
function onPreviewImage(idx: number): void {
  if (!task.value?.images?.length) return;
  uni.previewImage({
    urls: task.value.images,
    current: task.value.images[idx],
  });
}

// ---- 地图 ----
function onOpenLocation(): void {
  if (!task.value) return;
  uni.openLocation({
    latitude: task.value.lat,
    longitude: task.value.lng,
    name: task.value.title,
    address: task.value.address,
    fail: () => {
      uni.showToast({ title: '打开地图失败', icon: 'none' });
    },
  });
}

// 接收页面参数
onLoad((options) => {
  taskId = (options as { id?: string })?.id || '';
});
</script>

<style lang="scss" scoped>
.detail-page {
  min-height: 100vh;
  padding: 24rpx 24rpx 160rpx;
  background-color: #f8f8f8;
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 200rpx;
  gap: 24rpx;
}

.state-text {
  font-size: 28rpx;
  color: #999;
}

.state-btn {
  background-color: #4caf50;
  color: #fff;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.header-card,
.publisher-card,
.desc-card,
.images-card,
.location-card,
.timeline-card {
  background-color: #fff;
  border-radius: 20rpx;
  padding: 28rpx;
  box-shadow: 0 2rpx 16rpx rgba(0, 0, 0, 0.04);
}

.title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16rpx;
}

.title {
  flex: 1;
  font-size: 36rpx;
  font-weight: 600;
  color: #222;
  line-height: 1.4;
}

.status-tag {
  flex-shrink: 0;
  font-size: 22rpx;
  color: #fff;
  padding: 6rpx 16rpx;
  border-radius: 20rpx;
}

.price-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 16rpx;
}

.price {
  font-size: 40rpx;
  font-weight: 700;
  color: #e53935;
}

.category-tag {
  font-size: 24rpx;
  color: #666;
  background-color: #f0f0f0;
  padding: 4rpx 16rpx;
  border-radius: 16rpx;
}

.publisher-card {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  flex-shrink: 0;
}

.avatar-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #4caf50;
}

.avatar-ph-text {
  color: #fff;
  font-size: 32rpx;
}

.publisher-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.nickname {
  font-size: 28rpx;
  color: #333;
  font-weight: 500;
}

.publish-time {
  font-size: 24rpx;
  color: #999;
}

.view-count {
  flex-shrink: 0;
}

.view-text {
  font-size: 24rpx;
  color: #999;
}

.card-label {
  display: block;
  font-size: 26rpx;
  color: #888;
  margin-bottom: 16rpx;
}

.desc-text {
  font-size: 30rpx;
  color: #333;
  line-height: 1.7;
  white-space: pre-wrap;
}

.img-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.img {
  width: 218rpx;
  height: 218rpx;
  border-radius: 12rpx;
}

.location-card {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.loc-icon-wrap {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #e8f5e9;
  border-radius: 50%;
  flex-shrink: 0;
}

.loc-icon {
  font-size: 32rpx;
}

.loc-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.loc-label {
  font-size: 24rpx;
  color: #888;
}

.loc-address {
  font-size: 28rpx;
  color: #333;
}

.loc-arrow {
  color: #bbb;
  font-size: 40rpx;
}

.timeline {
  display: flex;
  flex-direction: column;
}

.tl-node {
  display: flex;
  align-items: flex-start;
  gap: 20rpx;
  padding-bottom: 32rpx;
  position: relative;
}

.tl-node:not(.tl-last)::before {
  content: '';
  position: absolute;
  left: 15rpx;
  top: 40rpx;
  bottom: 0;
  width: 2rpx;
  background-color: #e0e0e0;
}

.tl-dot {
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  border: 2rpx solid #ddd;
  background-color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  z-index: 1;
}

.dot-done {
  background-color: #4caf50;
  border-color: #4caf50;
}

.dot-check {
  color: #fff;
  font-size: 20rpx;
  font-weight: 700;
}

.tl-content {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  padding-top: 2rpx;
}

.tl-title {
  font-size: 28rpx;
  color: #999;
}

.tl-title-done {
  color: #333;
  font-weight: 500;
}

.tl-desc {
  font-size: 24rpx;
  color: #aaa;
}

.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 16rpx;
  padding: 20rpx 24rpx;
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  background-color: #fff;
  box-shadow: 0 -2rpx 16rpx rgba(0, 0, 0, 0.06);
}

.action-btn {
  flex: 1;
  height: 88rpx;
  line-height: 88rpx;
  font-size: 30rpx;
  border-radius: 44rpx;
  margin: 0;

  &::after {
    border: none;
  }

  &[disabled] {
    opacity: 0.6;
  }
}

.btn-primary {
  background-color: #4caf50;
  color: #fff;
}

.btn-secondary {
  background-color: #f0f0f0;
  color: #333;
}

.btn-danger {
  background-color: #fff;
  color: #e53935;
  border: 1rpx solid #e53935;
}
</style>
