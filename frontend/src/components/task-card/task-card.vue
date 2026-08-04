<template>
  <view class="task-card" @tap="onClick">
    <view class="cover-wrap">
      <image v-if="cover" class="cover" :src="cover" mode="aspectFill" />
      <view v-else class="cover cover-ph">
        <text class="cover-ph-text">{{ categoryLabel.slice(0, 1) }}</text>
      </view>
    </view>

    <view class="info">
      <text class="title">{{ item.title }}</text>

      <view class="meta">
        <text class="tag">{{ categoryLabel }}</text>
        <text v-if="distanceText" class="distance">{{ distanceText }}</text>
        <text v-if="item.address" class="addr">{{ item.address }}</text>
      </view>

      <view class="bottom">
        <view class="publisher">
          <image
            v-if="item.publisher?.avatar"
            class="avatar"
            :src="item.publisher.avatar"
            mode="aspectFill"
          />
          <view v-else class="avatar avatar-ph">
            <text class="avatar-ph-text">{{ initial }}</text>
          </view>
          <text class="nickname">{{ item.publisher?.nickname || '邻居' }}</text>
          <text class="time">{{ relativeTime }}</text>
        </view>
        <text class="price">¥{{ item.price }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { TASK_CATEGORY_LABELS } from '@/types';
import type { TaskListItem } from '@/types';

const props = defineProps<{ item: TaskListItem }>();
const emit = defineEmits<{ (e: 'click', item: TaskListItem): void }>();

const cover = computed(() => props.item.images?.[0] || '');
const categoryLabel = computed(() => TASK_CATEGORY_LABELS[props.item.category] || '其他');
const initial = computed(() => (props.item.publisher?.nickname || '邻').slice(0, 1));

const distanceText = computed(() => {
  const d = props.item.distance;
  if (d == null) return '';
  if (d < 1000) return `${d}m`;
  return `${(d / 1000).toFixed(1)}km`;
});

const relativeTime = computed(() => formatRelative(props.item.createdAt));

function onClick(): void {
  emit('click', props.item);
}

/** 相对时间格式化 */
function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)}天前`;
  // 超过 30 天显示日期
  const d = new Date(iso);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}
</script>

<style lang="scss" scoped>
.task-card {
  display: flex;
  background-color: #fff;
  border-radius: 16rpx;
  padding: 20rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);
}

.cover-wrap {
  flex-shrink: 0;
  width: 180rpx;
  height: 180rpx;
  border-radius: 12rpx;
  overflow: hidden;
}

.cover {
  width: 100%;
  height: 100%;
}

.cover-ph {
  background-color: #f0f0f0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-ph-text {
  font-size: 56rpx;
  color: #ccc;
  font-weight: bold;
}

.info {
  flex: 1;
  margin-left: 20rpx;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.title {
  font-size: 30rpx;
  font-weight: 600;
  color: #333;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 12rpx;
}

.tag {
  font-size: 22rpx;
  color: #4caf50;
  background-color: #e8f5e9;
  padding: 4rpx 14rpx;
  border-radius: 20rpx;
}

.distance {
  font-size: 22rpx;
  color: #888;
}

.addr {
  font-size: 22rpx;
  color: #999;
  max-width: 200rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 12rpx;
}

.publisher {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.avatar {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  flex-shrink: 0;
}

.avatar-ph {
  background-color: #4caf50;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-ph-text {
  color: #fff;
  font-size: 22rpx;
}

.nickname {
  font-size: 24rpx;
  color: #666;
  margin-left: 10rpx;
  max-width: 120rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time {
  font-size: 22rpx;
  color: #aaa;
  margin-left: 12rpx;
  flex-shrink: 0;
}

.price {
  font-size: 34rpx;
  font-weight: bold;
  color: #e53935;
  flex-shrink: 0;
}
</style>
