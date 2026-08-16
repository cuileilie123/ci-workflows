<template>
  <view class="review-form">
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
          v-for="tag in allTags"
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
</template>

<script setup lang="ts">
import { ref } from 'vue';

defineProps<{
  orderId: string;
  revieweeId: string;
}>();

const emit = defineEmits<{
  (e: 'success'): void;
  (e: 'cancel'): void;
}>();

const ratingLabels = ['非常差', '有待提高', '一般', '不错', '非常好'];

const positiveTags = ['准时到达', '态度友善', '专业靠谱', '超出预期', '沟通顺畅'];
const negativeTags = ['迟到爽约', '态度恶劣', '质量差', '沟通困难', '虚假描述'];
const allTags = [...positiveTags, ...negativeTags];

const rating = ref(5);
const selectedTags = ref<string[]>([]);
const comment = ref('');
const submitting = ref(false);

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

async function onSubmit(): Promise<void> {
  if (rating.value < 1) {
    uni.showToast({ title: '请选择评分', icon: 'none' });
    return;
  }
  submitting.value = true;
  try {
    // 实际调用 API（此处由父组件处理）
    emit('success');
  } finally {
    submitting.value = false;
  }
}

// 暴露数据给父组件
defineExpose({
  rating,
  selectedTags,
  comment,
});
</script>

<style lang="scss" scoped>
.review-form {
  padding: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 32rpx;
}

.section-label {
  display: block;
  font-size: 28rpx;
  color: #555;
  margin-bottom: 16rpx;
}

.rating-section {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
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
  display: flex;
  flex-direction: column;
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
  display: flex;
  flex-direction: column;
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
