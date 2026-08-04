<template>
  <view class="profile-page">
    <!-- 用户信息头部 -->
    <view class="header">
      <view class="avatar-wrap" @click="onAvatarClick">
        <image v-if="user?.avatar" :src="user.avatar" class="avatar" mode="aspectFill" />
        <view v-else class="avatar avatar-placeholder">{{ initial }}</view>
      </view>
      <view class="user-info">
        <text class="nickname">{{ user?.nickname || '未设置昵称' }}</text>
        <text v-if="false" class="bio"></text>
      </view>
    </view>

    <!-- 信用分卡片 -->
    <view class="credit-card" :style="{ background: creditBg }">
      <view class="credit-left">
        <view class="credit-ring">
          <view class="ring-bg" :style="ringStyle">
            <text class="credit-score">{{ credit.score }}</text>
          </view>
        </view>
      </view>
      <view class="credit-right">
        <text class="credit-level">{{ creditLabel }}</text>
        <text class="credit-desc">{{ creditDesc }}</text>
        <view class="privileges">
          <text v-for="(p, i) in creditPrivileges" :key="i" class="privilege-tag">{{ p }}</text>
        </view>
      </view>
    </view>

    <!-- 统计信息 -->
    <view class="stats-row">
      <view class="stat-item" @click="goTasks('published')">
        <text class="stat-num">{{ stats.published }}</text>
        <text class="stat-label">发布</text>
      </view>
      <view class="stat-item" @click="goTasks('accepted')">
        <text class="stat-num">{{ stats.accepted }}</text>
        <text class="stat-label">接单</text>
      </view>
      <view class="stat-item">
        <text class="stat-num">{{ credit.totalReviews }}</text>
        <text class="stat-label">评价</text>
      </view>
      <view class="stat-item">
        <text class="stat-num">{{ credit.avgRating }}</text>
        <text class="stat-label">均分</text>
      </view>
    </view>

    <!-- 评价分布 -->
    <view v-if="credit.totalReviews > 0" class="distribution-card">
      <text class="card-title">评分分布</text>
      <view class="distribution-list">
        <view v-for="star in 5" :key="star" class="dist-row">
          <text class="dist-label">{{ star }}星</text>
          <view class="dist-bar-bg">
            <view
              class="dist-bar"
              :style="{ width: getBarWidth(star) + '%', background: '#ffc107' }"
            />
          </view>
          <text class="dist-count">{{ credit.distribution[star] || 0 }}</text>
        </view>
      </view>
      <!-- 评价列表 -->
      <text class="card-title" style="margin-top: 24rpx;">全部评价</text>
      <view v-for="r in reviews" :key="r.id" class="review-item">
        <view class="reviewer-row">
          <image
            v-if="r.reviewer.avatar"
            :src="r.reviewer.avatar"
            class="reviewer-avatar"
            mode="aspectFill"
          />
          <view v-else class="reviewer-avatar avatar-placeholder-sm">
            {{ r.reviewer.nickname?.[0] || 'U' }}
          </view>
          <text class="reviewer-name">{{ r.reviewer.nickname }}</text>
          <text class="review-time">{{ formatTime(r.createdAt) }}</text>
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

      <view v-if="!hasMore" class="no-more">— 没有更多评价了 —</view>
      <view v-else-if="reviews.length > 0" class="load-more" @click="loadMore">加载更多</view>
    </view>

    <!-- 暂无评价 -->
    <view v-else class="empty-state">
      <text class="empty-icon">📝</text>
      <text class="empty-text">暂无评价，完成任务后可获得评价</text>
    </view>

    <!-- 菜单 -->
    <view class="menu-card">
      <view class="menu-item" @click="goMyTasks">
        <text class="menu-icon">📋</text>
        <text class="menu-label">我的任务</text>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @click="goMyOrders">
        <text class="menu-icon">💰</text>
        <text class="menu-label">我的订单</text>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @click="goWallet">
        <text class="menu-icon">👛</text>
        <text class="menu-label">我的钱包</text>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @click="goSettings">
        <text class="menu-icon">⚙️</text>
        <text class="menu-label">设置</text>
        <text class="menu-arrow">›</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useUserStore } from '@/store/user';
import { reviewApi, type CreditDetail, type ReviewData } from '@/api/review';

const userStore = useUserStore();
const user = computed(() => userStore.userInfo);

const credit = ref<CreditDetail>({
  score: 100,
  level: '良好',
  totalReviews: 0,
  avgRating: 0,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  completedCount: 0,
});

const reviews = ref<ReviewData[]>([]);
const page = ref(1);
const hasMore = ref(false);

const stats = ref({ published: 0, accepted: 0 });

// 初始占位
const creditBg = computed(() => {
  const s = credit.value.score;
  if (s >= 150) return 'linear-gradient(135deg, #FFD700, #FFA000)';
  if (s >= 100) return 'linear-gradient(135deg, #4CAF50, #2E7D32)';
  if (s >= 60) return 'linear-gradient(135deg, #8BC34A, #689F38)';
  return 'linear-gradient(135deg, #FF5722, #D84315)';
});

const ringStyle = computed(() => {
  const percent = Math.min(100, (credit.value.score / 200) * 100);
  return {
    background: `conic-gradient(#fff ${percent * 3.6}deg, rgba(255,255,255,0.3) 0deg)`,
  };
});

const creditLabel = computed(() => {
  const s = credit.value.score;
  if (s >= 150) return '优秀 ⭐⭐⭐';
  if (s >= 100) return '良好 ⭐⭐';
  if (s >= 60) return '一般 ⭐';
  return '受限 ⚠️';
});

const creditDesc = computed(() => {
  const s = credit.value.score;
  if (s >= 150) return '享受优先推荐、免押金等特权';
  if (s >= 100) return '信用良好，正常接单';
  if (s >= 60) return '可正常接单，注意维护信用';
  return '信用受限，仅可发单';
});

const creditPrivileges = computed(() => {
  const s = credit.value.score;
  if (s >= 150) return ['优先推荐', '免押金', '专属客服'];
  if (s >= 100) return ['正常接单', '信用评级良'];
  if (s >= 60) return ['正常接单'];
  return ['仅可发单'];
});

const initial = computed(() => user.value?.nickname?.[0] || 'U');

function getBarWidth(star: number): number {
  const total = credit.value.totalReviews || 1;
  return ((credit.value.distribution[star] || 0) / total) * 100;
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
  if (days < 30) return `${days}天前`;
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

async function loadCredit(): Promise<void> {
  const uid = user.value?.id;
  if (!uid) return;
  try {
    credit.value = await reviewApi.getCredit(uid);
  } catch {
    // 使用默认值
  }
}

async function loadReviews(reset = false): Promise<void> {
  const uid = user.value?.id;
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
  page.value++;
  await loadReviews();
}

function goTasks(type: 'published' | 'accepted'): void {
  uni.navigateTo({ url: `/pages/task/list?type=${type}` });
}

function goMyTasks(): void {
  uni.navigateTo({ url: '/pages/task/list?mine=true' });
}

function goMyOrders(): void {
  uni.navigateTo({ url: '/pages/task/list?orders=true' });
}

function goWallet(): void {
  uni.navigateTo({ url: '/pages/user/wallet' });
}

function goSettings(): void {
  uni.showToast({ title: '设置功能即将上线', icon: 'none' });
}

function onAvatarClick(): void {
  // TODO: 头像修改
}

onMounted(async () => {
  await userStore.fetchMe();
  await loadCredit();
  await loadReviews(true);
});

onShow(async () => {
  await userStore.fetchMe();
  await loadCredit();
  await loadReviews(true);
});
</script>

<style lang="scss" scoped>
.profile-page {
  min-height: 100vh;
  padding: 24rpx;
  background-color: #f5f5f5;
}

// Header
.header {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 32rpx 28rpx;
  background-color: #fff;
  border-radius: 20rpx;
}

.avatar-wrap {
  flex-shrink: 0;
}

.avatar {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  background-color: #e0e0e0;
}

.avatar-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #4caf50;
  color: #fff;
  font-size: 48rpx;
  font-weight: 600;
}

.avatar-placeholder-sm {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background-color: #4caf50;
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
}

.user-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.nickname {
  font-size: 36rpx;
  font-weight: 600;
  color: #333;
}

.bio {
  font-size: 26rpx;
  color: #888;
}

// Credit Card
.credit-card {
  display: flex;
  align-items: center;
  gap: 28rpx;
  margin-top: 24rpx;
  padding: 32rpx;
  border-radius: 20rpx;
  color: #fff;
}

.credit-left {
  flex-shrink: 0;
}

.credit-ring {
  width: 160rpx;
  height: 160rpx;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.3);
  padding: 10rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ring-bg {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
}

.credit-score {
  font-size: 48rpx;
  font-weight: 700;
  color: #333;
}

.credit-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.credit-level {
  font-size: 34rpx;
  font-weight: 600;
}

.credit-desc {
  font-size: 24rpx;
  opacity: 0.9;
}

.privileges {
  display: flex;
  gap: 12rpx;
  margin-top: 8rpx;
}

.privilege-tag {
  font-size: 22rpx;
  padding: 4rpx 16rpx;
  background-color: rgba(255, 255, 255, 0.3);
  border-radius: 20rpx;
}

// Stats
.stats-row {
  display: flex;
  justify-content: space-around;
  margin-top: 24rpx;
  padding: 28rpx 0;
  background-color: #fff;
  border-radius: 20rpx;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.stat-num {
  font-size: 40rpx;
  font-weight: 700;
  color: #333;
}

.stat-label {
  font-size: 24rpx;
  color: #888;
}

// Distribution
.distribution-card {
  margin-top: 24rpx;
  padding: 28rpx;
  background-color: #fff;
  border-radius: 20rpx;
}

.card-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: #333;
  margin-bottom: 20rpx;
}

.distribution-list {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.dist-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.dist-label {
  width: 80rpx;
  font-size: 24rpx;
  color: #666;
}

.dist-bar-bg {
  flex: 1;
  height: 16rpx;
  background-color: #f0f0f0;
  border-radius: 8rpx;
  overflow: hidden;
}

.dist-bar {
  height: 100%;
  border-radius: 8rpx;
  transition: width 0.5s;
}

.dist-count {
  width: 60rpx;
  text-align: right;
  font-size: 24rpx;
  color: #666;
}

// Review items
.review-item {
  padding: 24rpx 0;
  border-bottom: 1rpx solid #f0f0f0;

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
  margin-top: 8rpx;
}

.mini-star {
  font-size: 24rpx;
  color: #ddd;

  &.active {
    color: #ffc107;
  }
}

.review-comment {
  display: block;
  margin-top: 12rpx;
  font-size: 28rpx;
  color: #555;
  line-height: 1.6;
}

.review-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 12rpx;
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
  margin-top: 24rpx;
}

.load-more {
  display: block;
  text-align: center;
  font-size: 28rpx;
  color: #4caf50;
  margin-top: 24rpx;
}

// Empty state
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60rpx 0;
  gap: 16rpx;
  background-color: #fff;
  border-radius: 20rpx;
  margin-top: 24rpx;
}

.empty-icon {
  font-size: 64rpx;
}

.empty-text {
  font-size: 28rpx;
  color: #999;
}

// Menu
.menu-card {
  margin-top: 24rpx;
  background-color: #fff;
  border-radius: 20rpx;
  overflow: hidden;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 28rpx;
  border-bottom: 1rpx solid #f5f5f5;

  &:last-child {
    border-bottom: none;
  }
}

.menu-icon {
  font-size: 40rpx;
}

.menu-label {
  flex: 1;
  font-size: 30rpx;
  color: #333;
}

.menu-arrow {
  color: #ccc;
  font-size: 36rpx;
}
</style>
