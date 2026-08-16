<template>
  <view class="page">
    <view class="top-bar">
      <text class="page-title">订单改价</text>
      <text class="hint-text">仅可修改未完成订单</text>
    </view>

    <view class="filter-row">
      <input
        v-model="keyword"
        class="search-input"
        placeholder="搜索标题 / 发布者"
        confirm-type="search"
        @confirm="reload"
      />
      <view class="reload-btn" @click="reload"><text class="reload-text">刷新</text></view>
    </view>

    <view v-if="list.length" class="task-list">
      <view v-for="task in list" :key="task.id" class="task-card">
        <view class="task-head">
          <text class="task-title">{{ task.title }}</text>
          <text class="status-tag" :class="statusClass(task.status)">{{ statusLabel(task.status) }}</text>
        </view>
        <view class="task-meta">
          <text class="meta-text">¥{{ task.price.toFixed(2) }}</text>
          <text class="meta-text">{{ task.categoryName || '未分类' }}</text>
          <text class="meta-text">{{ task.publisherNickname || '匿名邻居' }}</text>
        </view>
        <view class="task-meta">
          <text class="meta-text meta-addr">{{ task.address || '未填地址' }}</text>
        </view>
        <view class="task-actions">
          <view class="op-btn primary" @click="openModify(task)">
            <text class="op-text">修改价格</text>
          </view>
        </view>
      </view>
    </view>

    <view v-else-if="!loading" class="empty">
      <text class="empty-text">暂无可改价订单</text>
    </view>

    <view v-if="hasMore" class="load-more" @click="loadMore">
      <text class="load-text">{{ loading ? '加载中...' : '加载更多' }}</text>
    </view>

    <!-- 改价弹窗 -->
    <view v-if="showModal" class="modal-mask" @click="closeModal">
      <view class="modal-content" @click.stop>
        <view class="modal-header">
          <text class="modal-title">修改订单价格</text>
          <view class="modal-close" @click="closeModal"><text class="close-icon">✕</text></view>
        </view>
        <view class="modal-body">
          <view class="task-preview">
            <text class="preview-title">{{ currentTask?.title }}</text>
            <text class="preview-meta">当前价格 ¥{{ currentTask?.price.toFixed(2) }}</text>
          </view>
          <view class="form-group">
            <text class="form-label">新价格（元）</text>
            <input
              v-model="form.newPrice"
              class="form-input"
              type="digit"
              placeholder="请输入新价格"
            />
          </view>
          <view class="form-group">
            <text class="form-label">改价原因（可选）</text>
            <textarea
              v-model="form.reason"
              class="form-textarea"
              placeholder="将展示给订单发布者确认"
              maxlength="200"
            />
          </view>
          <view class="diff-tip" :class="diffClass">
            <text class="diff-tip-text">{{ diffText }}</text>
          </view>
          <view class="flow-tip">
            <text class="flow-tip-text">
              提交后订单将打回发布者确认：价格上涨需发布者补差额，价格下降将退还差额，确认后订单重新进入待接单。
            </text>
          </view>
        </view>
        <view class="modal-footer">
          <view class="btn-cancel" @click="closeModal"><text class="btn-text">取消</text></view>
          <view class="btn-confirm" :class="{ disabled: saving }" @click="onSubmit">
            <text class="btn-text">{{ saving ? '提交中...' : '提交改价' }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { orderPriceApi } from '@/api/admin';
import type { PriceModifiableTask, TaskStatus } from '@/types';

const list = ref<PriceModifiableTask[]>([]);
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const hasMore = ref(false);
const loading = ref(false);
const keyword = ref('');

const showModal = ref(false);
const saving = ref(false);
const currentTask = ref<PriceModifiableTask | null>(null);

const form = reactive({
  newPrice: '',
  reason: '',
});

const numericNewPrice = computed(() => parseFloat(form.newPrice));
const diff = computed(() => {
  if (!currentTask.value || isNaN(numericNewPrice.value)) return 0;
  return numericNewPrice.value - currentTask.value.price;
});

const diffClass = computed(() => {
  if (diff.value > 0) return 'up';
  if (diff.value < 0) return 'down';
  return '';
});

const diffText = computed(() => {
  if (diff.value === 0) return '价格未变化';
  const sign = diff.value > 0 ? '+' : '';
  return `差额 ${sign}¥${diff.value.toFixed(2)}（${diff.value > 0 ? '需发布者补差' : '将退回发布者'}）`;
});

async function reload(): Promise<void> {
  page.value = 1;
  await loadData(true);
}

async function loadMore(): Promise<void> {
  if (!hasMore.value || loading.value) return;
  page.value += 1;
  await loadData(false);
}

async function loadData(reset: boolean): Promise<void> {
  loading.value = true;
  try {
    const res = await orderPriceApi.listIncompleteTasks(page.value, pageSize);
    const filtered = keyword.value.trim()
      ? res.list.filter(
          (t) =>
            t.title.includes(keyword.value.trim()) ||
            (t.publisherNickname ?? '').includes(keyword.value.trim()),
        )
      : res.list;
    if (reset) {
      list.value = filtered;
    } else {
      list.value = list.value.concat(filtered);
    }
    total.value = res.total;
    hasMore.value = page.value * pageSize < res.total;
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '加载失败', icon: 'none' });
  } finally {
    loading.value = false;
  }
}

function statusLabel(status: TaskStatus): string {
  const map: Record<string, string> = {
    OPEN: '已报价',
    ACCEPTED: '已接单',
    IN_PROGRESS: '进行中',
    PENDING: '待支付',
    PRICE_PENDING: '改价待确认',
  };
  return map[status] ?? status;
}

function statusClass(status: TaskStatus): string {
  const map: Record<string, string> = {
    OPEN: 'st-open',
    ACCEPTED: 'st-acc',
    IN_PROGRESS: 'st-prog',
    PENDING: 'st-pending',
    PRICE_PENDING: 'st-price',
  };
  return map[status] ?? 'st-open';
}

function openModify(task: PriceModifiableTask): void {
  currentTask.value = task;
  form.newPrice = String(task.price);
  form.reason = '';
  showModal.value = true;
}

function closeModal(): void {
  if (saving.value) return;
  showModal.value = false;
  currentTask.value = null;
}

async function onSubmit(): Promise<void> {
  if (!currentTask.value) return;
  if (isNaN(numericNewPrice.value) || numericNewPrice.value <= 0) {
    uni.showToast({ title: '请输入有效价格', icon: 'none' });
    return;
  }
  if (numericNewPrice.value === currentTask.value.price) {
    uni.showToast({ title: '新价格与原价相同', icon: 'none' });
    return;
  }
  saving.value = true;
  try {
    await orderPriceApi.createPriceModification(currentTask.value.id, {
      newPrice: numericNewPrice.value,
      reason: form.reason || undefined,
    });
    uni.showToast({ title: '已提交，等待发布者确认', icon: 'success' });
    showModal.value = false;
    currentTask.value = null;
    await reload();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '提交失败', icon: 'none' });
  } finally {
    saving.value = false;
  }
}

onShow(() => {
  reload();
});
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  padding: 24rpx;
  background-color: #f5f5f5;
  box-sizing: border-box;
}

.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16rpx;
}

.page-title {
  font-size: 36rpx;
  font-weight: 700;
  color: #333;
}

.hint-text {
  font-size: 24rpx;
  color: #999;
}

.filter-row {
  display: flex;
  gap: 16rpx;
  margin-bottom: 24rpx;
}

.search-input {
  flex: 1;
  height: 72rpx;
  padding: 0 24rpx;
  background-color: #fff;
  border-radius: 36rpx;
  font-size: 26rpx;
  box-sizing: border-box;
}

.reload-btn {
  padding: 0 28rpx;
  height: 72rpx;
  background-color: #4caf50;
  border-radius: 36rpx;
  display: flex;
  align-items: center;
}

.reload-text {
  color: #fff;
  font-size: 26rpx;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.task-card {
  padding: 28rpx;
  background-color: #fff;
  border-radius: 20rpx;
}

.task-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12rpx;
}

.task-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #333;
  flex: 1;
  margin-right: 16rpx;
}

.status-tag {
  padding: 4rpx 16rpx;
  border-radius: 20rpx;
  font-size: 22rpx;
  color: #fff;

  &.st-open {
    background-color: #4caf50;
  }
  &.st-acc {
    background-color: #2196f3;
  }
  &.st-prog {
    background-color: #ff9800;
  }
  &.st-pending {
    background-color: #9e9e9e;
  }
  &.st-price {
    background-color: #9c27b0;
  }
}

.task-meta {
  display: flex;
  gap: 24rpx;
  margin-bottom: 8rpx;
  flex-wrap: wrap;
}

.meta-text {
  font-size: 26rpx;
  color: #666;
}

.meta-addr {
  color: #999;
}

.task-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16rpx;
  border-top: 1rpx solid #f0f0f0;
  padding-top: 16rpx;
}

.op-btn {
  padding: 12rpx 36rpx;
  border-radius: 24rpx;
  background-color: #f0f0f0;

  &.primary {
    background-color: #ff9800;
  }
}

.op-text {
  font-size: 26rpx;
  color: #fff;
}

.empty {
  padding: 120rpx 0;
  text-align: center;
}

.empty-text {
  font-size: 28rpx;
  color: #999;
}

.load-more {
  padding: 32rpx 0;
  text-align: center;
}

.load-text {
  font-size: 26rpx;
  color: #4caf50;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-content {
  width: 640rpx;
  background-color: #fff;
  border-radius: 24rpx;
  overflow: hidden;
  max-height: 85vh;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 28rpx 32rpx;
  border-bottom: 1rpx solid #f0f0f0;
}

.modal-title {
  font-size: 34rpx;
  font-weight: 600;
  color: #333;
}

.modal-close {
  width: 60rpx;
  height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-icon {
  font-size: 32rpx;
  color: #999;
}

.modal-body {
  padding: 24rpx 32rpx;
}

.task-preview {
  padding: 20rpx;
  background-color: #f9f9f9;
  border-radius: 12rpx;
  margin-bottom: 24rpx;
}

.preview-title {
  display: block;
  font-size: 28rpx;
  color: #333;
  font-weight: 600;
  margin-bottom: 8rpx;
}

.preview-meta {
  font-size: 24rpx;
  color: #999;
}

.form-group {
  margin-bottom: 24rpx;
}

.form-label {
  font-size: 26rpx;
  color: #555;
  display: block;
  margin-bottom: 12rpx;
}

.form-input {
  width: 100%;
  height: 80rpx;
  border: 2rpx solid #e0e0e0;
  border-radius: 12rpx;
  padding: 0 20rpx;
  font-size: 28rpx;
  box-sizing: border-box;
}

.form-textarea {
  width: 100%;
  height: 140rpx;
  border: 2rpx solid #e0e0e0;
  border-radius: 12rpx;
  padding: 16rpx 20rpx;
  font-size: 28rpx;
  box-sizing: border-box;
}

.diff-tip {
  padding: 16rpx 20rpx;
  border-radius: 12rpx;
  margin-bottom: 16rpx;
  background-color: #f0f0f0;

  &.up {
    background-color: #fff3e0;
  }
  &.down {
    background-color: #e8f5e9;
  }
}

.diff-tip-text {
  font-size: 26rpx;
  color: #333;
}

.flow-tip {
  padding: 16rpx 20rpx;
  background-color: #fff8e1;
  border-radius: 12rpx;
}

.flow-tip-text {
  font-size: 24rpx;
  color: #795548;
  line-height: 1.5;
}

.modal-footer {
  display: flex;
  border-top: 1rpx solid #f0f0f0;
}

.btn-cancel,
.btn-confirm {
  flex: 1;
  padding: 28rpx 0;
  text-align: center;
}

.btn-cancel {
  border-right: 1rpx solid #f0f0f0;
}

.btn-confirm {
  background-color: #ff9800;

  &.disabled {
    background-color: #ffe0b2;
  }

  .btn-text {
    color: #fff;
  }
}

.btn-text {
  font-size: 30rpx;
  color: #333;
}
</style>
