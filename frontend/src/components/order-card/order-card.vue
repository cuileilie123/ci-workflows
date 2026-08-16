<template>
  <view class="order-card" @click="$emit('click', order)">
    <view class="order-header">
      <text class="order-id">#{{ order.id.slice(-6) }}</text>
      <text class="order-status" :style="{ color: statusColor }">{{ statusText }}</text>
    </view>
    <view class="order-body">
      <image v-if="order.images?.[0]" :src="order.images[0]" class="cover" mode="aspectFill" />
      <view class="order-info">
        <text class="title">{{ order.title }}</text>
        <text class="price">¥{{ order.price }}</text>
        <text class="time">{{ formatTime(order.createdAt) }}</text>
      </view>
    </view>
    <view v-if="actions.length" class="order-actions">
      <button
        v-for="action in actions"
        :key="action.type"
        class="action-btn"
        :class="action.style"
        @click.stop="onAction(action.type)"
      >
        {{ action.label }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface TaskOrder {
  id: string;
  title: string;
  price: number;
  images?: string[];
  status: string;
  role: 'publisher' | 'accepter';
  createdAt: string;
}

const props = defineProps<{
  order: TaskOrder;
}>();

const emit = defineEmits<{
  click: [order: TaskOrder];
  action: [type: string];
}>();

const statusConfig: Record<string, { text: string; color: string }> = {
  BIDDING: { text: '已报价', color: '#ff9800' },
  PENDING: { text: '已报价', color: '#ff9800' },
  ACCEPTED: { text: '已接单', color: '#2196f3' },
  IN_PROGRESS: { text: '进行中', color: '#4caf50' },
  COMPLETED: { text: '已完成', color: '#9e9e9e' },
  CANCELLED: { text: '已取消', color: '#f44336' },
  PAID: { text: '已支付', color: '#4caf50' },
};

const statusText = computed(() => statusConfig[props.order.status]?.text || props.order.status);
const statusColor = computed(() => statusConfig[props.order.status]?.color || '#666');

const actions = computed(() => {
  const { status, role } = props.order;
  const list: Array<{ type: string; label: string; style: string }> = [];

  if (status === 'PENDING' && role === 'publisher') {
    list.push({ type: 'cancel', label: '取消', style: 'secondary' });
  }
  if (status === 'ACCEPTED' && role === 'publisher') {
    list.push({ type: 'pay', label: '去支付', style: 'primary' });
  }
  if (status === 'PAID' && role === 'accepter') {
    list.push({ type: 'start', label: '开始服务', style: 'primary' });
  }
  if (status === 'IN_PROGRESS' && role === 'publisher') {
    list.push({ type: 'confirm', label: '确认完成', style: 'primary' });
  }
  if (status === 'COMPLETED' && role === 'publisher') {
    list.push({ type: 'review', label: '去评价', style: 'primary' });
  }

  return list;
});

function onAction(type: string): void {
  emit('action', type);
}

function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (days < 7) return `${days}天前`;
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
</script>

<style lang="scss" scoped>
.order-card {
  margin: 24rpx;
  background-color: #fff;
  border-radius: 20rpx;
  overflow: hidden;
}

.order-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24rpx 28rpx;
  border-bottom: 1rpx solid #f5f5f5;
}

.order-id {
  font-size: 26rpx;
  color: #999;
}

.order-status {
  font-size: 26rpx;
  font-weight: 500;
}

.order-body {
  display: flex;
  gap: 24rpx;
  padding: 28rpx;
}

.cover {
  width: 160rpx;
  height: 160rpx;
  border-radius: 12rpx;
  background-color: #f0f0f0;
  flex-shrink: 0;
}

.order-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  justify-content: space-between;
}

.title {
  font-size: 30rpx;
  font-weight: 500;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.price {
  font-size: 36rpx;
  font-weight: 700;
  color: #ff5722;
}

.time {
  font-size: 24rpx;
  color: #999;
}

.order-actions {
  display: flex;
  justify-content: flex-end;
  gap: 24rpx;
  padding: 24rpx 28rpx;
  border-top: 1rpx solid #f5f5f5;
}

.action-btn {
  padding: 16rpx 40rpx;
  border-radius: 30rpx;
  font-size: 28rpx;
  border: none;
  background-color: transparent;
  margin: 0;
  line-height: 1.5;

  &::after {
    border: none;
  }

  &.primary {
    background-color: #4caf50;
    color: #fff;
  }

  &.secondary {
    border: 2rpx solid #ddd;
    color: #666;
  }
}
</style>
