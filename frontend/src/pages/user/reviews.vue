<template>
  <scroll-view class="reviews-page" scroll-y>
    <!-- 评分统计 -->
    <view class="rating-overview">
      <text class="big-score">{{ avgRating.toFixed(1) }}</text>
      <view class="stars">
        <text
          v-for="i in 5"
          :key="i"
          class="star"
          :class="{ active: i <= Math.round(avgRating) }"
        >★</text>
      </view>
      <text class="total">共 {{ reviews.length }} 条评价</text>
    </view>

    <!-- 标签统计 -->
    <view v-if="tagStats.length" class="tag-cloud">
      <text
        v-for="tag in tagStats"
        :key="tag.name"
        class="tag"
        :class="{ hot: tag.count > 5 }"
      >
        {{ tag.name }} ({{ tag.count }})
      </text>
    </view>

    <!-- 评价列表 -->
    <view class="review-list">
      <view v-for="r in reviews" :key="r.id" class="review-item">
        <view class="reviewer-row">
          <image
            v-if="r.reviewer.avatar"
            :src="r.reviewer.avatar"
            class="reviewer-avatar"
            mode="aspectFill"
          />
          <view v-else class="reviewer-avatar avatar-placeholder">
            <text>{{ r.reviewer.nickname?.[0] || 'U' }}</text>
          </view>
          <text class="reviewer-name">{{ r.reviewer.nickname }}</text>
          <text class="review-time">{{ formatRelativeTime(r.createdAt) }}</text>
        </view>
        <view class="review-rating">
          <text
            v-for="i in 5"
            :key="i"
            class="mini-star"
            :class="{ active: i <= r.rating }"
          >★</text>
        </view>
        <text v-if="r.comment" class="review-comment">{{ r.comment }}</text>
        <view v-if="r.tags?.length" class="review-tags">
          <text v-for="tag in r.tags" :key="tag" class="review-tag">{{ tag }}</text>
        </view>
      </view>
    </view>

    <view v-if="!hasMore && reviews.length > 0" class="no-more">— 没有更多了 —</view>
    <view v-else-if="reviews.length > 0" class="load-more" @click="loadMore">加载更多</view>

    <view v-if="reviews.length === 0" class="empty-state">
      <text class="empty-icon">📝</text>
      <text class="empty-text">暂无评价</text>
    </view>
  </scroll-view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { reviewApi, type ReviewData } from '@/api/review';
import { useUserStore } from '@/store/user';
import { formatRelativeTime } from '@/utils/format';

const userStore = useUserStore();
const reviews = ref<ReviewData[]>([]);
const page = ref(1);
const hasMore = ref(false);

const avgRating = computed(() => {
  if (reviews.value.length === 0) return 0;
  const sum = reviews.value.reduce((s, r) => s + r.rating, 0);
  return sum / reviews.value.length;
});

interface TagStat {
  name: string;
  count: number;
}

const tagStats = computed<TagStat[]>(() => {
  const map: Record<string, number> = {};
  reviews.value.forEach((r) => {
    r.tags?.forEach((tag) => {
      map[tag] = (map[tag] || 0) + 1;
    });
  });
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
});

async function loadReviews(reset = false): Promise<void> {
  const uid = userStore.userInfo?.id;
  if (!uid) return;
  if (reset) page.value = 1;
  try {
    const result = await reviewApi.getUserReviews(uid, page.value);
    if (reset) {
      reviews.value = result.list;
    } else {
      reviews.value.push(...result.list);
    }
    hasMore.value = result.hasMore;
  } catch {
    // 忽略
  }
}

async function loadMore(): Promise<void> {
  if (!hasMore.value) return;
  page.value++;
  await loadReviews();
}

onMounted(async () => {
  await loadReviews(true);
});
</script>

<style lang="scss" scoped>
.reviews-page {
  min-height: 100vh;
  padding: 24rpx;
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  background-color: #f5f5f5;
}

.rating-overview {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48rpx 32rpx;
  background-color: #fff;
  border-radius: 20rpx;
  gap: 16rpx;
}

.big-score {
  font-size: 96rpx;
  font-weight: 700;
  color: #ffc107;
}

.stars {
  display: flex;
  gap: 8rpx;
}

.star {
  font-size: 40rpx;
  color: #ddd;

  &.active {
    color: #ffc107;
  }
}

.total {
  font-size: 26rpx;
  color: #999;
}

.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 24rpx;
  padding: 28rpx;
  background-color: #fff;
  border-radius: 20rpx;
}

.tag {
  font-size: 24rpx;
  padding: 8rpx 20rpx;
  background-color: #f0f0f0;
  color: #666;
  border-radius: 20rpx;

  &.hot {
    background-color: #fff3e0;
    color: #ff9800;
  }
}

.review-list {
  margin-top: 24rpx;
  background-color: #fff;
  border-radius: 20rpx;
  overflow: hidden;
}

.review-item {
  padding: 28rpx;
  border-bottom: 1rpx solid #f5f5f5;

  &:last-child {
    border-bottom: none;
  }
}

.reviewer-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.reviewer-avatar {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background-color: #e0e0e0;
  flex-shrink: 0;

  image {
    width: 100%;
    height: 100%;
    border-radius: 50%;
  }
}

.avatar-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #4caf50;
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
}

.reviewer-name {
  font-size: 28rpx;
  font-weight: 500;
  color: #333;
  flex: 1;
}

.review-time {
  font-size: 24rpx;
  color: #999;
}

.review-rating {
  display: flex;
  gap: 4rpx;
  margin-top: 12rpx;
}

.mini-star {
  font-size: 28rpx;
  color: #ddd;

  &.active {
    color: #ffc107;
  }
}

.review-comment {
  display: block;
  margin-top: 16rpx;
  font-size: 28rpx;
  color: #555;
  line-height: 1.6;
}

.review-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 16rpx;
}

.review-tag {
  font-size: 22rpx;
  padding: 4rpx 16rpx;
  background-color: #e8f5e9;
  color: #4caf50;
  border-radius: 20rpx;
}

.no-more {
  display: block;
  text-align: center;
  font-size: 24rpx;
  color: #ccc;
  margin-top: 32rpx;
}

.load-more {
  display: block;
  text-align: center;
  font-size: 28rpx;
  color: #4caf50;
  margin-top: 32rpx;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 120rpx 0;
  gap: 20rpx;
  margin-top: 24rpx;
  background-color: #fff;
  border-radius: 20rpx;
}

.empty-icon {
  font-size: 80rpx;
}

.empty-text {
  font-size: 28rpx;
  color: #999;
}
</style>
