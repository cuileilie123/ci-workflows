<template>
  <view class="review-page">
    <!-- 加载中 -->
    <view v-if="loading" class="state state-loading">
      <text class="state-text">加载中...</text>
    </view>

    <!-- 评价表单 -->
    <view v-else-if="orderInfo" class="review-form">
      <!-- 订单信息 -->
      <view class="order-info">
        <text class="order-label">订单评价</text>
        <view class="order-row">
          <text class="order-title">{{ orderInfo.taskTitle || '任务订单' }}</text>
          <text class="order-amount">¥{{ orderInfo.totalAmount }}</text>
        </view>
      </view>

      <!-- 评价对象 -->
      <view class="reviewee-info">
        <image
          v-if="reviewee?.avatar"
          :src="reviewee.avatar"
          class="avatar"
          mode="aspectFill"
        />
        <view v-else class="avatar avatar-placeholder">
          {{ reviewee?.nickname?.[0] || 'U' }}
        </view>
        <text class="reviewee-name">{{ reviewee?.nickname || '用户' }}</text>
      </view>

      <!-- 星级评分 -->
      <view class="rating-section">
        <text class="section-label">评分</text>
        <view class="stars">
          <text
            v-for="i in 5"
            :key="i"
            class="star"
            :class="{ active: i <= rating }"
            @click="setRating(i)"
          >
            ★
          </text>
          <text class="rating-label">{{ ratingLabels[rating - 1] || '请评分' }}</text>
        </view>
      </view>

      <!-- 标签选择 -->
      <view class="tags-section">
        <text class="section-label">印象标签（可多选，最多 3 个）</text>
        <view class="tags-group">
          <view
            v-for="tag in currentTags"
            :key="tag"
            class="tag-item"
            :class="{ active: selectedTags.includes(tag) }"
            @click="toggleTag(tag)"
          >
            {{ tag }}
          </view>
        </view>
      </view>

      <!-- 文字评价 -->
      <view class="comment-section">
        <text class="section-label">文字评价</text>
        <textarea
          v-model="comment"
          class="comment-input"
          :maxlength="500"
          placeholder="说说你的感受吧..."
          auto-height
        />
        <text class="char-count">{{ comment.length }}/500</text>
      </view>

      <!-- 提交按钮 -->
      <view class="submit-bar">
        <button
          class="submit-btn"
          :disabled="submitting || rating < 1"
          @click="onSubmit"
        >
          {{ submitting ? '提交中...' : '提交评价' }}
        </button>
      </view>
    </view>

    <!-- 加载失败 -->
    <view v-else class="state state-error">
      <text class="state-text">{{ error || '加载失败' }}</text>
      <button class="state-btn" size="mini" @click="loadOrderInfo">重新加载</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { reviewApi } from '@/api/review';
import { paymentApi } from '@/api/payment';
import type { OrderQueryResult } from '@/api/payment';
import { useUserStore } from '@/store/user';

const loading = ref(false);
const error = ref('');
const submitting = ref(false);

const orderId = ref('');
const orderInfo = ref<OrderQueryResult | null>(null);
const reviewee = ref<{ id: string; nickname: string; avatar: string | null } | null>(null);

const rating = ref(5);
const selectedTags = ref<string[]>([]);
const comment = ref('');

const ratingLabels = ['非常差', '有待提高', '一般', '不错', '非常好'];

const positiveTags = ['准时到达', '态度友善', '专业靠谱', '超出预期', '沟通顺畅'];
const negativeTags = ['迟到爽约', '态度恶劣', '质量差', '沟通困难', '虚假描述'];
const currentTags = computed(() => {
  // 根据评分自动切换标签类型（>=4星显示正面标签，<4星显示负面标签）
  return rating.value >= 4 ? positiveTags : negativeTags;
});

function setRating(val: number): void {
  rating.value = val;
}

function toggleTag(tag: string): void {
  const idx = selectedTags.value.indexOf(tag);
  if (idx >= 0) {
    selectedTags.value.splice(idx, 1);
  } else {
    if (selectedTags.value.length >= 3) {
      uni.showToast({ title: '最多选 3 个标签', icon: 'none' });
      return;
    }
    selectedTags.value.push(tag);
  }
}

async function loadOrderInfo(): Promise<void> {
  if (!orderId.value) return;
  loading.value = true;
  error.value = '';
  try {
    orderInfo.value = await paymentApi.queryOrder(orderId.value);

    // 根据当前用户身份确定被评价者：
    //   当前用户 = 发布者 → 评价 helperId（帮助者）
    //   当前用户 = 帮助者 → 评价 publisherId（发布者）
    const userStore = useUserStore();
    const currentUid = userStore.userInfo?.id ? String(userStore.userInfo.id) : '';
    const publisherId = orderInfo.value.publisherId ?? '';
    const helperId = orderInfo.value.helperId ?? '';
    let revieweeId = '';
    let revieweeNick = '交易对手';
    if (currentUid && currentUid === publisherId) {
      // 当前是发布者，评价帮助者
      revieweeId = helperId;
      revieweeNick = '帮助者';
    } else if (currentUid && currentUid === helperId) {
      // 当前是帮助者，评价发布者
      revieweeId = publisherId;
      revieweeNick = '任务发布者';
    } else {
      // 无法判断时，取与当前用户不同的那个 ID 作为被评价者
      if (publisherId && publisherId !== currentUid) {
        revieweeId = publisherId;
        revieweeNick = '任务发布者';
      } else if (helperId && helperId !== currentUid) {
        revieweeId = helperId;
        revieweeNick = '帮助者';
      } else {
        revieweeId = helperId || publisherId || '';
      }
    }
    // 如果订单本身还返回了任务标题，追加友好提示
    const taskName = orderInfo.value.taskTitle ? `（${orderInfo.value.taskTitle}）` : '';
    reviewee.value = {
      id: revieweeId,
      nickname: `${revieweeNick}${taskName}`,
      avatar: null,
    };
  } catch (e) {
    error.value = (e as Error).message || '加载失败';
  } finally {
    loading.value = false;
  }
}

async function onSubmit(): Promise<void> {
  if (rating.value < 1) {
    uni.showToast({ title: '请选择评分', icon: 'none' });
    return;
  }

  submitting.value = true;
  try {
    await reviewApi.create({
      orderId: orderId.value,
      revieweeId: reviewee.value?.id || '',
      rating: rating.value,
      tags: selectedTags.value,
      comment: comment.value,
    });
    uni.showToast({ title: '评价成功', icon: 'success' });
    setTimeout(() => {
      uni.navigateBack();
    }, 1500);
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '提交失败', icon: 'none' });
  } finally {
    submitting.value = false;
  }
}

onLoad((options) => {
  orderId.value = (options as { orderId?: string })?.orderId || '';
});

onMounted(() => {
  loadOrderInfo();
});
</script>

<style lang="scss" scoped>
.review-page {
  min-height: 100vh;
  padding: 24rpx;
  background-color: #f5f5f5;
  padding-bottom: 160rpx;
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 200rpx;
}

.state-text {
  font-size: 28rpx;
  color: #999;
}

.state-btn {
  margin-top: 24rpx;
}

.review-form {
  display: flex;
  flex-direction: column;
  gap: 32rpx;
}

.order-info {
  padding: 24rpx;
  background-color: #fff;
  border-radius: 16rpx;
}

.order-label {
  font-size: 24rpx;
  color: #999;
  margin-bottom: 12rpx;
}

.order-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.order-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #333;
}

.order-amount {
  font-size: 32rpx;
  font-weight: 700;
  color: #ff6b00;
}

.reviewee-info {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx;
  background-color: #fff;
  border-radius: 16rpx;
}

.avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background-color: #e0e0e0;
}

.avatar-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #4caf50;
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
}

.reviewee-name {
  font-size: 30rpx;
  font-weight: 500;
  color: #333;
}

.rating-section {
  padding: 24rpx;
  background-color: #fff;
  border-radius: 16rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.section-label {
  font-size: 28rpx;
  color: #666;
}

.stars {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.star {
  font-size: 56rpx;
  color: #ddd;
  transition: color 0.2s;

  &.active {
    color: #ffc107;
  }
}

.rating-label {
  margin-left: 16rpx;
  font-size: 28rpx;
  color: #ff9500;
}

.tags-section {
  padding: 24rpx;
  background-color: #fff;
  border-radius: 16rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.tags-group {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.tag-item {
  padding: 12rpx 24rpx;
  background-color: #f5f5f5;
  border-radius: 32rpx;
  font-size: 26rpx;
  color: #666;
  border: 1rpx solid transparent;
  transition: all 0.2s;

  &.active {
    background-color: #e8f5e9;
    color: #4caf50;
    border-color: #4caf50;
  }
}

.comment-section {
  padding: 24rpx;
  background-color: #fff;
  border-radius: 16rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.comment-input {
  width: 100%;
  min-height: 200rpx;
  padding: 20rpx;
  background-color: #f8f8f8;
  border-radius: 16rpx;
  font-size: 28rpx;
  box-sizing: border-box;
}

.char-count {
  display: block;
  text-align: right;
  font-size: 24rpx;
  color: #999;
  margin-top: 8rpx;
}

.submit-bar {
  padding-top: 16rpx;
}

.submit-btn {
  background-color: #4caf50;
  color: #fff;
  border-radius: 44rpx;
  height: 88rpx;
  line-height: 88rpx;
  font-size: 30rpx;

  &::after {
    border: none;
  }

  &[disabled] {
    opacity: 0.5;
  }
}
</style>
