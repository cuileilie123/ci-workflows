<template>
  <view class="search-page">
    <!-- 搜索栏 -->
    <view class="search-bar">
      <view class="search-input-wrapper">
        <text class="search-icon">🔍</text>
        <input
          v-model="keyword"
          class="search-input"
          placeholder="搜索任务..."
          confirm-type="search"
          @input="onInput"
          @focus="showSuggest = true"
          @confirm="onSearch"
        />
        <text v-if="keyword" class="clear-icon" @click="clearKeyword">✕</text>
      </view>
      <button class="search-btn" @click="onSearch">搜索</button>
    </view>

    <!-- 搜索建议 -->
    <view v-if="showSuggest && suggestions.length" class="suggest-list">
      <view
        v-for="s in suggestions"
        :key="s"
        class="suggest-item"
        @click="selectSuggestion(s)"
      >
        <text class="suggest-icon">🔍</text>
        <text class="suggest-text">{{ s }}</text>
      </view>
    </view>

    <!-- 筛选栏 -->
    <view v-if="hasSearched" class="filter-bar">
      <view class="filter-item" @click="showCategoryPicker = true">
        <text>{{ selectedCategory || '全部分类' }}</text>
        <text class="filter-arrow">▼</text>
      </view>
      <view class="filter-item" @click="showPricePicker = true">
        <text>{{ priceRangeText }}</text>
        <text class="filter-arrow">▼</text>
      </view>
      <view class="filter-info">
        <text class="result-count">共 {{ total }} 条结果</text>
        <text v-if="duration" class="duration">({{ duration }}ms)</text>
      </view>
    </view>

    <!-- 搜索结果 -->
    <view v-if="hasSearched" class="result-list">
      <view
        v-for="item in results"
        :key="item.id"
        class="result-item"
        @click="goToDetail(item.id)"
      >
        <view class="result-header">
          <text class="result-title">
            <text
              v-for="(seg, i) in highlightSegments(item.title)"
              :key="i"
              :class="{ highlight: seg.highlight }"
            >{{ seg.text }}</text>
          </text>
          <text class="result-price">¥{{ item.price }}</text>
        </view>
        <text class="result-desc">
          <text
            v-for="(seg, i) in highlightSegments(item.description)"
            :key="i"
            :class="{ highlight: seg.highlight }"
          >{{ seg.text }}</text>
        </text>
        <view class="result-footer">
          <text class="result-location">{{ item.location }}</text>
          <text class="result-category">{{ getCategoryLabel(item.category) }}</text>
        </view>
      </view>

      <!-- 加载更多 -->
      <view v-if="hasMore" class="load-more" @click="loadMore">
        <text>加载更多</text>
      </view>
      <view v-else-if="results.length" class="no-more">
        <text>没有更多了</text>
      </view>
    </view>

    <!-- 空状态 -->
    <view v-if="hasSearched && !results.length && !loading" class="empty-state">
      <text class="empty-icon">ℹ️</text>
      <text class="empty-text">未找到相关任务</text>
      <text class="empty-hint">换个关键词试试吧</text>
    </view>

    <!-- 分类选择器 -->
    <view v-if="showCategoryPicker" class="popup-overlay" @click="showCategoryPicker = false">
      <view class="picker-wrapper" @click.stop>
        <view class="picker-content">
          <view class="picker-header">
            <text class="picker-title">选择分类</text>
            <text class="picker-cancel" @click="showCategoryPicker = false">取消</text>
          </view>
          <view class="picker-list">
            <view class="picker-item" @click="selectCategory('')">
              <text :class="{ 'picker-item-active': !selectedCategory }">全部分类</text>
            </view>
            <view
              v-for="cat in categories"
              :key="cat.value"
              class="picker-item"
              @click="selectCategory(cat.value)"
            >
              <text :class="{ 'picker-item-active': selectedCategory === cat.value }">
                {{ cat.label }}
              </text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- 价格选择器 -->
    <view v-if="showPricePicker" class="popup-overlay" @click="showPricePicker = false">
      <view class="picker-wrapper" @click.stop>
        <view class="picker-content">
          <view class="picker-header">
            <text class="picker-title">价格区间</text>
            <text class="picker-cancel" @click="showPricePicker = false">取消</text>
          </view>
          <view class="picker-list">
            <view class="picker-item" @click="selectPriceRange(null)">
              <text :class="{ 'picker-item-active': !priceRange }">不限</text>
            </view>
            <view
              v-for="range in priceRanges"
              :key="range.label"
              class="picker-item"
              @click="selectPriceRange(range)"
            >
              <text :class="{ 'picker-item-active': priceRange?.label === range.label }">
                {{ range.label }}
              </text>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { searchTasks, getSuggestions } from '@/api/search';
import type { SearchResult } from '@/api/search';

interface HighlightSegment {
  text: string;
  highlight: boolean;
}

interface SearchParams {
  q?: string;
  page: number;
  size: number;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
}

const timers: ReturnType<typeof setTimeout>[] = [];

function debounce<T extends (...args: never[]) => unknown>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return function (this: unknown, ...args: Parameters<T>) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
    timers.push(timer);
  };
}

const keyword = ref('');
const suggestions = ref<string[]>([]);
const showSuggest = ref(false);
const results = ref<SearchResult['items']>([]);
const total = ref(0);
const duration = ref(0);
const hasMore = ref(false);
const loading = ref(false);
const hasSearched = ref(false);
const page = ref(1);

const selectedCategory = ref('');
const priceRange = ref<{ min: number; max: number; label: string } | null>(null);
const showCategoryPicker = ref(false);
const showPricePicker = ref(false);

const categories = [
  { label: '跑腿代拿', value: 'DELIVERY' },
  { label: '代购代买', value: 'SHOPPING' },
  { label: '清洁打扫', value: 'CLEANING' },
  { label: '维修安装', value: 'REPAIR' },
  { label: '辅导家教', value: 'TUTORING' },
  { label: '宠物照顾', value: 'PET_CARE' },
  { label: '搬家搬运', value: 'MOVING' },
  { label: '其他', value: 'OTHER' },
];

const priceRanges = [
  { label: '0-50元', min: 0, max: 50 },
  { label: '50-100元', min: 50, max: 100 },
  { label: '100-200元', min: 100, max: 200 },
  { label: '200元以上', min: 200, max: 99999 },
];

const priceRangeText = computed(() => priceRange.value?.label || '价格不限');

const fetchSuggest = debounce(async (q: string) => {
  if (!q) {
    suggestions.value = [];
    return;
  }
  try {
    const data = await getSuggestions(q);
    suggestions.value = data || [];
  } catch (e) {
    console.warn('[Search] 获取搜索建议失败', e);
    // 保持现有的建议列表不变
  }
}, 300);

function onInput(e: Event) {
  const detail = (e as unknown as { detail?: { value?: string } }).detail;
  fetchSuggest(detail?.value || keyword.value);
}

function clearKeyword() {
  keyword.value = '';
  suggestions.value = [];
}

function selectSuggestion(s: string) {
  keyword.value = s;
  showSuggest.value = false;
  page.value = 1;
  doSearch();
}

async function onSearch() {
  showSuggest.value = false;
  page.value = 1;
  doSearch();
}

async function doSearch() {
  if (!keyword.value.trim() && !selectedCategory.value && !priceRange.value) return;

  loading.value = true;
  try {
    const params: SearchParams = {
      q: keyword.value || undefined,
      page: page.value,
      size: 20,
    };

    if (selectedCategory.value) {
      params.category = selectedCategory.value;
    }

    if (priceRange.value) {
      params.minPrice = priceRange.value.min;
      params.maxPrice = priceRange.value.max;
    }

    const data = await searchTasks(params);
    if (page.value === 1) {
      results.value = data.items || [];
    } else {
      results.value = [...results.value, ...(data.items || [])];
    }
    total.value = data.total;
    duration.value = data.duration;
    hasMore.value = data.items.length === 20;
    hasSearched.value = true;
  } catch (e: unknown) {
    uni.showToast({ title: (e as Error).message || '搜索失败', icon: 'none' });
  } finally {
    loading.value = false;
  }
}

function loadMore() {
  page.value++;
  doSearch();
}

function selectCategory(cat: string) {
  selectedCategory.value = cat;
  showCategoryPicker.value = false;
  page.value = 1;
  doSearch();
}

function selectPriceRange(range: typeof priceRange.value) {
  priceRange.value = range;
  showPricePicker.value = false;
  page.value = 1;
  doSearch();
}

function goToDetail(id: number) {
  uni.navigateTo({ url: `/pages/task/detail?id=${id}` });
}

function highlightSegments(text: string): HighlightSegment[] {
  if (!keyword.value || !text) {
    return [{ text, highlight: false }];
  }

  // 对搜索关键词进行正则转义，避免特殊字符破坏正则
  const escapedKeyword = keyword.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const kwRegex = new RegExp(`^${escapedKeyword}$`, 'i');
  const regex = new RegExp(`(${escapedKeyword})`, 'gi');
  const parts = text.split(regex);

  return parts
    .filter((part) => part !== '')
    .map((part) => ({
      text: part,
      highlight: kwRegex.test(part),
    }));
}

function getCategoryLabel(value: string): string {
  return categories.find((c) => c.value === value)?.label || value;
}

onMounted(() => {
  // 从路由参数获取关键词
  const pages = getCurrentPages();
  const currentPage = pages[pages.length - 1] as { options?: { q?: string } } | undefined;
  if (currentPage?.options?.q) {
    keyword.value = currentPage.options.q;
    onSearch();
  }
});

onUnmounted(() => {
  timers.forEach(t => clearTimeout(t));
  timers.length = 0;
});
</script>

<style scoped>
.search-page {
  min-height: 100vh;
  background: #f5f5f5;
}

.search-bar {
  display: flex;
  align-items: center;
  padding: 20rpx 24rpx;
  background: #fff;
  gap: 16rpx;
}

.search-input-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  padding: 16rpx 24rpx;
  background: #f5f5f5;
  border-radius: 32rpx;
  gap: 12rpx;
}

.search-input {
  flex: 1;
  font-size: 28rpx;
}

.search-btn {
  padding: 16rpx 32rpx;
  background: #4CAF50;
  color: #fff;
  border: none;
  border-radius: 32rpx;
  font-size: 28rpx;
}

.suggest-list {
  background: #fff;
  border-top: 1rpx solid #eee;
}

.suggest-item {
  display: flex;
  align-items: center;
  padding: 24rpx 32rpx;
  gap: 16rpx;
}

.suggest-text {
  font-size: 28rpx;
  color: #333;
}

.filter-bar {
  display: flex;
  align-items: center;
  padding: 20rpx 24rpx;
  background: #fff;
  margin-bottom: 16rpx;
  gap: 24rpx;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 8rpx;
  font-size: 26rpx;
  color: #666;
}

.filter-info {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.result-count {
  font-size: 24rpx;
  color: #999;
}

.duration {
  font-size: 22rpx;
  color: #ccc;
}

.result-list {
  padding: 0 24rpx;
}

.result-item {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 16rpx;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12rpx;
}

.result-title {
  font-size: 30rpx;
  font-weight: 500;
  color: #333;
  flex: 1;
}

.result-price {
  font-size: 32rpx;
  color: #ff6b35;
  font-weight: 500;
}

.result-desc {
  font-size: 26rpx;
  color: #666;
  line-height: 1.6;
  margin-bottom: 16rpx;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.result-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.result-location {
  font-size: 24rpx;
  color: #999;
}

.result-category {
  font-size: 22rpx;
  color: #4CAF50;
  background: #e8f5e9;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
}

.load-more,
.no-more {
  text-align: center;
  padding: 32rpx;
  color: #999;
  font-size: 26rpx;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 120rpx 0;
  gap: 16rpx;
}

.empty-text {
  font-size: 28rpx;
  color: #999;
}

.empty-hint {
  font-size: 24rpx;
  color: #ccc;
}

.search-icon {
  font-size: 32rpx;
}

.clear-icon {
  font-size: 32rpx;
  color: #999;
}

.suggest-icon {
  font-size: 28rpx;
}

.filter-arrow {
  font-size: 20rpx;
  color: #999;
}

.empty-icon {
  font-size: 96rpx;
  color: #ccc;
}

.popup-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 999;
  display: flex;
  align-items: flex-end;
}

.picker-wrapper {
  width: 100%;
}

.picker-content {
  background: #fff;
  border-radius: 24rpx 24rpx 0 0;
  padding-bottom: env(safe-area-inset-bottom);
}

.picker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32rpx;
  border-bottom: 1rpx solid #eee;
}

.picker-title {
  font-size: 30rpx;
  font-weight: 500;
}

.picker-cancel {
  font-size: 28rpx;
  color: #999;
}

.picker-list {
  max-height: 600rpx;
  overflow-y: auto;
}

.picker-item {
  padding: 32rpx;
  border-bottom: 1rpx solid #f5f5f5;
}

.picker-item text {
  font-size: 28rpx;
  color: #333;
}

.picker-item-active {
  color: #4CAF50 !important;
  font-weight: 500;
}

/* 高亮关键词样式 */
.highlight {
  color: #4CAF50;
  font-weight: 600;
  background-color: rgba(76, 175, 80, 0.1);
  padding: 0 4rpx;
  border-radius: 4rpx;
}
</style>