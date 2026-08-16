<template>
  <view class="list-page">
    <!-- 搜索栏 -->
    <view class="search-bar">
      <view class="search-input-wrap">
        <view class="search-icon" />
        <input
          class="search-input"
          :value="keyword"
          placeholder="搜索任务标题/描述/地点"
          placeholder-class="search-ph"
          confirm-type="search"
          @input="onSearchInput"
          @confirm="onSearchConfirm"
        />
        <text v-if="keyword" class="search-clear" @tap="clearKeyword">×</text>
      </view>
    </view>

    <!-- 搜索历史（关键词为空且有历史时展示） -->
    <view v-if="!keyword && history.length" class="history-bar">
      <view class="history-head">
        <text class="history-title">搜索历史</text>
        <text class="history-clear" @tap="clearHistory">清空</text>
      </view>
      <view class="history-tags">
        <text
          v-for="h in history"
          :key="h"
          class="history-tag"
          @tap="onHistoryTap(h)"
        >{{ h }}</text>
      </view>
    </view>

    <!-- 分类九宫格（搜索模式下隐藏） -->
    <view v-if="!keyword" class="category-grid">
      <view
        v-for="cat in categoryOptions"
        :key="cat.key || 'all'"
        class="category-item"
        :class="{ 'category-active': selectedCategory === cat.key }"
        @tap="onCategoryTap(cat.key)"
      >
        <text class="category-label">{{ cat.label }}</text>
      </view>
    </view>

    <!-- 搜索结果提示 -->
    <view v-if="keyword" class="search-tip">
      <text class="search-tip-text">搜索“{{ keyword }}”的结果</text>
    </view>

    <!-- 定位失败引导 -->
    <view v-if="showLocationBanner" class="banner location-banner">
      <view class="banner-text">
        <text class="banner-title">未获取到位置信息</text>
        <text class="banner-desc">开启定位后可查看附近任务，或使用上方搜索</text>
      </view>
      <button class="banner-btn" size="mini" @click="openSetting">去设置</button>
    </view>

    <!-- 任务列表区 -->
    <view class="list-body">
      <!-- 骨架屏 -->
      <view v-if="loading && !list.length" class="skeleton-list">
        <view v-for="n in 4" :key="n" class="skeleton-card">
          <view class="sk-cover" />
          <view class="sk-info">
            <view class="sk-line sk-title" />
            <view class="sk-line sk-meta" />
            <view class="sk-line sk-bottom" />
          </view>
        </view>
      </view>

      <!-- 任务卡片 -->
      <view v-else>
        <task-card
          v-for="item in list"
          :key="item.id"
          :item="item"
          @click="onCardTap"
        />

        <!-- 加载更多状态 -->
        <view v-if="list.length" class="load-status">
          <text v-if="loading" class="load-text">加载中...</text>
          <text v-else-if="!hasMore" class="load-text">没有更多了</text>
          <text v-else class="load-text">上拉加载更多</text>
        </view>
      </view>

      <!-- 空状态 -->
      <view v-if="!loading && !list.length && !error" class="state-empty">
        <view class="state-icon-empty" />
        <text class="state-text">{{ keyword ? '未找到相关任务' : '附近暂无任务' }}</text>
        <button v-if="!keyword" class="state-btn" size="mini" @click="goPublish">去发布</button>
      </view>

      <!-- 错误状态 -->
      <view v-if="error && !list.length" class="state-error">
        <view class="state-icon-error" />
        <text class="state-text">加载失败，请重试</text>
        <button class="state-btn" size="mini" @click="loadFirstPage">重新加载</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad, onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app';
import { taskApi } from '@/api';
import { TASK_CATEGORY_LABELS } from '@/types';
import type { TaskCategory, TaskListItem, TaskListResult } from '@/types';
import { tracker, EVENTS } from '@/utils/track';

// ---- 分类选项 ----
interface CategoryOption {
  key: '' | TaskCategory;
  label: string;
}
const categoryOptions: CategoryOption[] = [
  { key: '', label: '全部' },
  ...(Object.keys(TASK_CATEGORY_LABELS) as TaskCategory[]).map((k) => ({
    key: k,
    label: TASK_CATEGORY_LABELS[k],
  })),
];

// ---- 状态 ----
const keyword = ref('');
const selectedCategory = ref<'' | TaskCategory>('');
const list = ref<TaskListItem[]>([]);
const page = ref(1);
const hasMore = ref(true);
const loading = ref(false);
const error = ref(false);

// ---- 定位 ----
const lat = ref<number | null>(null);
const lng = ref<number | null>(null);
const locationStatus = ref<'loading' | 'ready' | 'denied'>('loading');
const LAST_LOC_KEY = 'nh_last_location';

const showLocationBanner = computed(
  () => !keyword.value && locationStatus.value === 'denied' && !loading.value && !list.value.length,
);

// ---- 搜索历史 ----
const HISTORY_KEY = 'nh_search_history';
const history = ref<string[]>([]);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

// ============ 生命周期 ============
onLoad(() => {
  // 埋点：页面访问
  tracker.track(EVENTS.PAGE_VIEW, {
    page: 'task_list',
  });
  
  loadHistory();
  initLocation();
});

onPullDownRefresh(async () => {
  await loadFirstPage();
  uni.stopPullDownRefresh();
});

onReachBottom(() => {
  loadMore();
});

// ============ 定位 ============
function initLocation(): void {
  // 先尝试缓存位置兜底
  const cached = uni.getStorageSync(LAST_LOC_KEY) as { lat: number; lng: number } | undefined;
  if (cached && typeof cached.lat === 'number') {
    lat.value = cached.lat;
    lng.value = cached.lng;
  }

  uni.getLocation({
    type: 'gcj02',
    success: (res) => {
      lat.value = res.latitude;
      lng.value = res.longitude;
      uni.setStorageSync(LAST_LOC_KEY, { lat: res.latitude, lng: res.longitude });
      locationStatus.value = 'ready';
      loadFirstPage();
    },
    fail: (err) => {
      const msg = String(err.errMsg || '');
      // 用户取消不算拒绝
      if (msg.includes('cancel')) {
        if (lat.value != null && lng.value != null) {
          locationStatus.value = 'ready';
          loadFirstPage();
        }
        return;
      }
      // 有缓存则用缓存继续
      if (lat.value != null && lng.value != null) {
        locationStatus.value = 'ready';
        loadFirstPage();
      } else {
        locationStatus.value = 'denied';
      }
    },
  });
}

function openSetting(): void {
  uni.openSetting({
    success: (res) => {
      if (res.authSetting['scope.userLocation']) {
        locationStatus.value = 'loading';
        initLocation();
      }
    },
  });
}

// ============ 搜索 ============
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onSearchInput(e: any): void {
  keyword.value = (e?.detail?.value ?? '') as string;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    // 进入或退出搜索模式均重置加载
    loadFirstPage();
  }, 500);
}

function onSearchConfirm(): void {
  if (searchTimer) clearTimeout(searchTimer);
  const kw = keyword.value.trim();
  if (kw) {
    // 埋点：搜索事件
    tracker.track(EVENTS.SEARCH, {
      keyword: kw,
      page: 'task_list',
    });
    addHistory(kw);
  }
  loadFirstPage();
}

function clearKeyword(): void {
  keyword.value = '';
  if (searchTimer) clearTimeout(searchTimer);
  loadFirstPage();
}

// ============ 搜索历史 ============
function loadHistory(): void {
  const v = uni.getStorageSync(HISTORY_KEY);
  history.value = Array.isArray(v) ? (v as string[]) : [];
}

function addHistory(kw: string): void {
  const next = history.value.filter((h) => h !== kw);
  next.unshift(kw);
  history.value = next.slice(0, 10);
  uni.setStorageSync(HISTORY_KEY, history.value);
}

function onHistoryTap(kw: string): void {
  keyword.value = kw;
  if (searchTimer) clearTimeout(searchTimer);
  loadFirstPage();
}

function clearHistory(): void {
  history.value = [];
  uni.removeStorageSync(HISTORY_KEY);
}

// ============ 分类筛选 ============
function onCategoryTap(key: '' | TaskCategory): void {
  if (selectedCategory.value === key) return;
  selectedCategory.value = key;
  
  // 埋点：分类筛选事件
  tracker.track(EVENTS.SEARCH, {
    category: key,
    page: 'task_list',
    action: 'filter_category',
  });
  
  loadFirstPage();
}

// ============ 列表加载 ============
async function loadFirstPage(): Promise<void> {
  page.value = 1;
  hasMore.value = true;
  list.value = [];
  await fetchList(false);
}

async function loadMore(): Promise<void> {
  if (loading.value || !hasMore.value) return;
  // 搜索模式或定位就绪才可加载更多
  if (!keyword.value && locationStatus.value !== 'ready') return;
  page.value += 1;
  await fetchList(true);
}

async function fetchList(append: boolean): Promise<void> {
  const kw = keyword.value.trim();

  // 附近模式需要定位
  if (!kw && (lat.value == null || lng.value == null)) {
    loading.value = false;
    return;
  }

  loading.value = true;
  error.value = false;
  try {
    let res: TaskListResult;
    if (kw) {
      res = await taskApi.search(kw, page.value);
    } else {
      res = await taskApi.listNearby({
        lat: lat.value as number,
        lng: lng.value as number,
        page: page.value,
        category: selectedCategory.value || undefined,
      });
    }
    list.value = append ? list.value.concat(res.list) : res.list;
    hasMore.value = res.hasMore;
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}

// ============ 卡片点击 ============
function onCardTap(item: TaskListItem): void {
  tracker.track(EVENTS.TASK_CLICK, {
    taskId: item.id,
    category: item.category,
    price: parseFloat(item.price),
    page: 'task_list',
  });
  uni.navigateTo({ url: `/pages/task/detail?id=${item.id}` });
}

function goPublish(): void {
  uni.navigateTo({ url: '/pages/task/publish' });
}
</script>

<style lang="scss" scoped>
.list-page {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding-bottom: 40rpx;
}

// ---- 搜索栏 ----
.search-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 16rpx 24rpx;
  background-color: #fff;
  box-shadow: 0 1rpx 6rpx rgba(0, 0, 0, 0.04);
}

.search-input-wrap {
  display: flex;
  align-items: center;
  height: 72rpx;
  padding: 0 20rpx;
  background-color: #f5f5f5;
  border-radius: 36rpx;
}

.search-icon {
  width: 26rpx;
  height: 26rpx;
  border: 4rpx solid #999;
  border-radius: 50%;
  margin-right: 12rpx;
  flex-shrink: 0;
  position: relative;
}

.search-icon::after {
  content: '';
  position: absolute;
  right: -8rpx;
  bottom: -4rpx;
  width: 14rpx;
  height: 4rpx;
  background-color: #999;
  border-radius: 2rpx;
  transform: rotate(45deg);
}

.search-input {
  flex: 1;
  font-size: 28rpx;
  color: #333;
}

.search-ph {
  color: #bbb;
}

.search-clear {
  width: 40rpx;
  height: 40rpx;
  line-height: 36rpx;
  text-align: center;
  color: #999;
  font-size: 36rpx;
}

// ---- 搜索历史 ----
.history-bar {
  padding: 20rpx 24rpx;
  background-color: #fff;
  border-bottom: 1rpx solid #f0f0f0;
}

.history-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16rpx;
}

.history-title {
  font-size: 26rpx;
  color: #666;
}

.history-clear {
  font-size: 24rpx;
  color: #999;
}

.history-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.history-tag {
  font-size: 24rpx;
  color: #555;
  background-color: #f0f0f0;
  padding: 8rpx 22rpx;
  border-radius: 24rpx;
}

// ---- 分类九宫格 ----
.category-grid {
  display: flex;
  flex-wrap: wrap;
  padding: 20rpx 20rpx 4rpx;
  background-color: #fff;
  border-bottom: 1rpx solid #f0f0f0;
}

.category-item {
  width: 25%;
  display: flex;
  justify-content: center;
  margin-bottom: 20rpx;
}

.category-label {
  font-size: 26rpx;
  color: #555;
  padding: 10rpx 24rpx;
  background-color: #f5f5f5;
  border-radius: 28rpx;
}

.category-active .category-label {
  background-color: #4caf50;
  color: #fff;
}

// ---- 搜索结果提示 ----
.search-tip {
  padding: 16rpx 24rpx;
  background-color: #fff;
  border-bottom: 1rpx solid #f0f0f0;
}

.search-tip-text {
  font-size: 26rpx;
  color: #888;
}

// ---- 定位失败 banner ----
.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 20rpx 24rpx 0;
  padding: 24rpx;
  border-radius: 16rpx;
}

.location-banner {
  background-color: #fff8e1;
}

.banner-text {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.banner-title {
  font-size: 28rpx;
  color: #e65100;
  font-weight: 600;
}

.banner-desc {
  font-size: 24rpx;
  color: #a66e00;
  margin-top: 8rpx;
}

.banner-btn {
  flex-shrink: 0;
  background-color: #ff9800;
  color: #fff;
  font-size: 24rpx;

  &::after {
    border: none;
  }
}

// ---- 列表区 ----
.list-body {
  padding: 20rpx 24rpx 0;
}

// ---- 骨架屏 ----
.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.skeleton-card {
  display: flex;
  background-color: #fff;
  border-radius: 16rpx;
  padding: 20rpx;
}

.sk-cover {
  width: 180rpx;
  height: 180rpx;
  border-radius: 12rpx;
  background-color: #eeeeee;
  flex-shrink: 0;
}

.sk-info {
  flex: 1;
  margin-left: 20rpx;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
}

.sk-line {
  height: 24rpx;
  border-radius: 12rpx;
  background-color: #eeeeee;
}

.sk-title {
  width: 70%;
  height: 30rpx;
}

.sk-meta {
  width: 50%;
}

.sk-bottom {
  width: 90%;
}

// ---- 加载状态 ----
.load-status {
  text-align: center;
  padding: 24rpx 0;
}

.load-text {
  font-size: 24rpx;
  color: #999;
}

// ---- 空/错状态 ----
.state-empty,
.state-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 100rpx 0;
}

.state-icon-empty,
.state-icon-error {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  background-color: #f0f0f0;
  position: relative;
}

.state-icon-empty::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 56rpx;
  height: 40rpx;
  margin-left: -28rpx;
  margin-top: -24rpx;
  border: 6rpx solid #c4c4c4;
  border-radius: 6rpx;
}

.state-icon-empty::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 24rpx;
  height: 6rpx;
  margin-left: -12rpx;
  margin-top: 16rpx;
  background-color: #c4c4c4;
  border-radius: 3rpx;
}

.state-icon-error::before {
  content: '!';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 60rpx;
  font-weight: bold;
  color: #e57373;
}

.state-text {
  font-size: 28rpx;
  color: #999;
  margin-top: 20rpx;
}

.state-btn {
  margin-top: 28rpx;
  background-color: #4caf50;
  color: #fff;
  font-size: 26rpx;

  &::after {
    border: none;
  }
}
</style>
