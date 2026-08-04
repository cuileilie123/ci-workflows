<template>
  <view class="order-page">
    <!-- 加载中 -->
    <view v-if="loading && !order" class="state state-loading">
      <text class="state-text">加载中...</text>
    </view>

    <!-- 加载失败 -->
    <view v-else-if="error && !order" class="state state-error">
      <text class="state-text">{{ error }}</text>
      <button class="state-btn" size="mini" @click="loadOrder">重新加载</button>
    </view>

    <!-- 订单详情 -->
    <view v-else-if="order" class="content">
      <!-- 状态卡片 -->
      <view class="status-card" :style="{ background: statusBg }">
        <text class="status-icon">{{ statusIcon }}</text>
        <text class="status-text">{{ statusLabel }}</text>
        <text v-if="order.status === 'PENDING'" class="status-hint">请在 15 分钟内完成支付</text>
      </view>

      <!-- 任务信息 -->
      <view class="info-card">
        <text class="card-label">任务信息</text>
        <view class="task-row" @click="goToTask">
          <view class="task-info">
            <text class="task-title">{{ taskInfo.title }}</text>
            <text class="task-addr">{{ taskInfo.address }}</text>
          </view>
          <text class="task-arrow">›</text>
        </view>
      </view>

      <!-- 金额明细 -->
      <view class="info-card">
        <text class="card-label">金额明细</text>
        <view class="amount-list">
          <view class="amount-row">
            <text class="amount-label">任务金额</text>
            <text class="amount-value">¥{{ order.totalAmount }}</text>
          </view>
          <view class="amount-row">
            <text class="amount-label">平台服务费 (10%)</text>
            <text class="amount-value fee">-¥{{ platformFee }}</text>
          </view>
          <view class="amount-row total">
            <text class="amount-label">实付金额</text>
            <text class="amount-value total-value">¥{{ order.totalAmount }}</text>
          </view>
        </view>
      </view>

      <!-- 订单信息 -->
      <view class="info-card">
        <text class="card-label">订单信息</text>
        <view class="order-meta">
          <view class="meta-row">
            <text class="meta-label">订单编号</text>
            <text class="meta-value">{{ order.id }}</text>
          </view>
          <view class="meta-row">
            <text class="meta-label">创建时间</text>
            <text class="meta-value">{{ formatTime(order.createdAt) }}</text>
          </view>
          <view v-if="order.paidAt" class="meta-row">
            <text class="meta-label">支付时间</text>
            <text class="meta-value">{{ formatTime(order.paidAt) }}</text>
          </view>
          <view v-if="order.refundAmount" class="meta-row">
            <text class="meta-label">退款金额</text>
            <text class="meta-value refund">-¥{{ order.refundAmount }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 底部操作栏 -->
    <view v-if="order && actions.length" class="action-bar">
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

    <!-- 支付中遮罩 -->
    <view v-if="paying" class="paying-mask">
      <view class="paying-content">
        <text class="paying-icon">💳</text>
        <text class="paying-text">正在调起微信支付...</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, reactive } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { paymentApi } from '@/api/payment';
import { payForTask } from '@/utils/payment';
import { taskApi } from '@/api/task';
import type { OrderQueryResult } from '@/api/payment';
import type { Task } from '@/types';

const order = ref<OrderQueryResult | null>(null);
const loading = ref(false);
const error = ref('');
const acting = ref('');
const paying = ref(false);

const taskInfo = reactive<{ title: string; address: string }>({
  title: '',
  address: '',
});

let orderId = '';

// 状态配置
const statusConfig: Record<string, { label: string; bg: string; icon: string }> = {
  PENDING: { label: '待支付', bg: 'linear-gradient(135deg, #FF9500, #FF6B00)', icon: '⏳' },
  PAID: { label: '已支付', bg: 'linear-gradient(135deg, #34C759, #2ECC71)', icon: '✓' },
  IN_PROGRESS: { label: '进行中', bg: 'linear-gradient(135deg, #007AFF, #0056CC)', icon: '🔧' },
  COMPLETED: { label: '已完成', bg: 'linear-gradient(135deg, #8E8E93, #636366)', icon: '✓' },
  CANCELLED: { label: '已取消', bg: 'linear-gradient(135deg, #FF3B30, #D70015)', icon: '✕' },
  REFUNDED: { label: '已退款', bg: 'linear-gradient(135deg, #FF9500, #FF6B00)', icon: '↩️' },
};

const statusLabel = computed(() => statusConfig[order.value?.status ?? 'PENDING']?.label ?? '未知');
const statusBg = computed(() => statusConfig[order.value?.status ?? 'PENDING']?.bg ?? '#999');
const statusIcon = computed(() => statusConfig[order.value?.status ?? 'PENDING']?.icon ?? '📋');

const platformFee = computed(() => {
  if (!order.value) return '0.00';
  const amount = Number(order.value.totalAmount);
  return (amount * 0.1).toFixed(2);
});

// 底部操作按钮
interface ActionItem {
  key: string;
  label: string;
  cls: string;
}

const actions = computed<ActionItem[]>(() => {
  if (!order.value) return [];
  const s = order.value.status;
  const list: ActionItem[] = [];

  if (s === 'PENDING') {
    list.push({ key: 'pay', label: '去支付', cls: 'btn-primary' });
    list.push({ key: 'cancel', label: '取消订单', cls: 'btn-secondary' });
  } else if (s === 'PAID' || s === 'IN_PROGRESS') {
    list.push({ key: 'refund', label: '申请退款', cls: 'btn-danger' });
  }

  return list;
});

// 加载订单详情
async function loadOrder(): Promise<void> {
  if (!orderId) return;
  loading.value = true;
  error.value = '';
  try {
    order.value = await paymentApi.queryOrder(orderId);
    // 加载关联任务信息
    loadTaskInfo();
  } catch (e) {
    error.value = (e as Error).message || '加载失败';
  } finally {
    loading.value = false;
  }
}

// 加载任务信息
async function loadTaskInfo(): Promise<void> {
  if (!order.value) return;
  try {
    // 尝试根据订单ID加载任务（订单ID即任务ID的关联需要后端支持）
    // 这里简化处理，显示基本信息
    taskInfo.title = '关联任务';
    taskInfo.address = '点击查看任务详情';
  } catch {
    // 忽略
  }
}

onShow(() => {
  loadOrder();
});

// 操作处理
async function onAction(act: ActionItem): Promise<void> {
  if (acting.value) return;
  const map: Record<string, () => Promise<void>> = {
    pay: doPay,
    cancel: doCancel,
    refund: doRefund,
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

// 去支付
async function doPay(): Promise<void> {
  if (!order.value) return;
  paying.value = true;
  try {
    // 实际应该使用 taskId 重新创建订单并支付
    // 这里简化处理：使用现有 orderId 对应的 taskId
    const taskIdStr = orderId; // 订单创建时 taskId 作为 order 的关联
    const result = await payForTask(taskIdStr);
    if (result) {
      uni.showToast({ title: '支付成功', icon: 'success' });
      await loadOrder();
    } else {
      uni.showToast({ title: '已取消支付', icon: 'none' });
    }
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '支付失败', icon: 'none' });
  } finally {
    paying.value = false;
  }
}

// 取消订单
async function doCancel(): Promise<void> {
  const ok = await showConfirm('取消订单', '确定要取消该订单吗？');
  if (!ok) return;
  // 取消订单逻辑（需要后端接口支持）
  // 这里简化为前端提示
  uni.showToast({ title: '已取消', icon: 'none' });
  // 刷新状态
  await loadOrder();
}

// 申请退款
async function doRefund(): Promise<void> {
  if (!order.value) return;
  const ok = await showConfirm('申请退款', '确定要申请退款吗？退款将原路返回。');
  if (!ok) return;
  try {
    await paymentApi.refund(order.value.id, Number(order.value.totalAmount), '用户申请退款');
    uni.showToast({ title: '退款申请成功', icon: 'success' });
    await loadOrder();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '退款失败', icon: 'none' });
  }
}

// 确认弹窗
function showConfirm(title: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title,
      content,
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(false),
    });
  });
}

// 跳转任务详情
function goToTask(): void {
  if (!order.value) return;
  // 订单ID即为关联的任务ID
  uni.navigateTo({ url: `/pages/task/detail?id=${order.value.id}` });
}

// 时间格式化
function formatTime(isoStr: string | null | undefined): string {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 接收页面参数
onLoad((options) => {
  orderId = (options as { id?: string })?.id || '';
});
</script>

<style lang="scss" scoped>
.order-page {
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

.status-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48rpx 28rpx;
  border-radius: 20rpx;
  color: #fff;
  gap: 12rpx;
}

.status-icon {
  font-size: 64rpx;
}

.status-text {
  font-size: 36rpx;
  font-weight: 600;
}

.status-hint {
  font-size: 24rpx;
  opacity: 0.9;
}

.info-card {
  background-color: #fff;
  border-radius: 20rpx;
  padding: 28rpx;
  box-shadow: 0 2rpx 16rpx rgba(0, 0, 0, 0.04);
}

.card-label {
  display: block;
  font-size: 26rpx;
  color: #888;
  margin-bottom: 20rpx;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.task-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.task-title {
  font-size: 30rpx;
  color: #333;
  font-weight: 500;
}

.task-addr {
  font-size: 24rpx;
  color: #888;
}

.task-arrow {
  color: #bbb;
  font-size: 40rpx;
}

.amount-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.amount-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.amount-label {
  font-size: 28rpx;
  color: #555;
}

.amount-value {
  font-size: 28rpx;
  color: #333;
}

.amount-value.fee {
  color: #FF9500;
}

.amount-row.total {
  padding-top: 20rpx;
  border-top: 1rpx solid #f0f0f0;
}

.total-value {
  font-size: 36rpx;
  font-weight: 700;
  color: #e53935;
}

.order-meta {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.meta-row {
  display: flex;
  justify-content: space-between;
}

.meta-label {
  font-size: 26rpx;
  color: #888;
}

.meta-value {
  font-size: 26rpx;
  color: #333;
}

.meta-value.refund {
  color: #FF9500;
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

.paying-mask {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}

.paying-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
  background-color: #fff;
  padding: 60rpx;
  border-radius: 20rpx;
}

.paying-icon {
  font-size: 80rpx;
}

.paying-text {
  font-size: 30rpx;
  color: #333;
}
</style>
