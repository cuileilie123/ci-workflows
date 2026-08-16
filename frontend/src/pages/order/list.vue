<template>
  <view class="order-list-page">
    <!-- 顶部 Tab 栏 -->
    <view class="tabs-bar">
      <scroll-view class="tabs-scroll" scroll-x :scroll-into-view="'tab-' + currentTab" scroll-with-animation>
        <view
          v-for="tab in tabs"
          :key="tab.status"
          :id="'tab-' + tab.status"
          :class="['tab-item', { active: currentTab === tab.status }]"
          @click="switchTab(tab.status)"
        >
          <text class="tab-label">{{ tab.label }}</text>
          <text v-if="tab.count" class="tab-badge">{{ tab.count }}</text>
          <view v-if="currentTab === tab.status" class="tab-indicator" />
        </view>
      </scroll-view>
    </view>

    <!-- 加载中 -->
    <view v-if="showLoading" class="state-loading">
      <text class="loading-spinner" />
      <text class="loading-text">加载中...</text>
    </view>

    <!-- 订单视图 -->
    <view v-else-if="isOrderView && orders.length > 0" class="order-list">
      <order-card
        v-for="order in filteredOrders"
        :key="order.id"
        :order="order"
        @click="goOrderDetail"
        @action="onOrderAction"
      />

      <view v-if="!hasMore && filteredOrders.length > 0" class="list-footer">
        <text class="footer-text">没有更多订单了</text>
      </view>
    </view>

    <!-- 我的发布视图 -->
    <view v-else-if="isMyTasksView && myTasks.length > 0" class="task-list">
      <view
        v-for="task in myTasks"
        :key="task.id"
        class="task-card"
        @click="goTaskDetail(task)"
      >
        <view class="task-header">
          <text class="task-title">{{ task.title }}</text>
          <text :class="['task-status', 'status-' + task.status]">{{ task.statusLabel }}</text>
        </view>
        <view class="task-meta">
          <text class="task-category">{{ task.categoryName }}</text>
          <text class="task-price">¥{{ task.price }}</text>
        </view>
        <view class="task-footer">
          <text class="task-time">{{ task.createdAtLabel }}</text>
          <view class="task-actions">
            <text
              v-if="task.canCancel"
              class="action-btn cancel-btn"
              @click.stop="onCancelTask(task)"
            >取消</text>
            <text
              v-if="task.canDelete"
              class="action-btn delete-btn"
              @click.stop="onDeleteTask(task)"
            >删除</text>
          </view>
        </view>
      </view>

      <view v-if="!hasMore && myTasks.length > 0" class="list-footer">
        <text class="footer-text">没有更多任务了</text>
      </view>
    </view>

    <!-- 空状态 -->
    <view v-else class="state-empty">
      <text class="empty-icon">{{ emptyIcon }}</text>
      <text class="empty-title">{{ emptyTitle }}</text>
      <text class="empty-desc">{{ emptyDesc }}</text>
      <button v-if="currentTab === MY_TAB" class="empty-btn" size="mini" @click="goPublish">去发布任务</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, getCurrentInstance } from 'vue';
import { onLoad, onPullDownRefresh, onReachBottom, onUnload } from '@dcloudio/uni-app';
import { paymentApi, type OrderQueryResult } from '@/api/payment';
import { taskApi } from '@/api/task';
import { useUserStore } from '@/store/user';
import { TASK_CATEGORY_LABELS } from '@/types';
import OrderCard from '@/components/order-card/order-card.vue';
import { tracker, EVENTS } from '@/utils/track';
import type { TaskStatus, TaskListItem } from '@/types';

const userStore = useUserStore();

// ========== 常量 ==========
const MY_TAB = '__my';
const PAGE_SIZE = 10;

/** 订单状态 → Tab 分组 */
const ORDER_GROUP_MAP: Record<string, string> = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  IN_PROGRESS: 'ACCEPTED',
  PAID: 'ACCEPTED',
  COMPLETED: 'COMPLETED',
};

/** 任务状态标签 */
const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: '已报价',
  ASSIGNED: '已接单',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  PRICE_PENDING: '待确认改价',
  EXPIRED: '已过期',
};

/** 哪些状态可取消（非终态） */
const TASK_CANCELABLE: readonly TaskStatus[] = ['OPEN', 'ASSIGNED', 'EXPIRED'] as const;
/** 哪些终态可删除 */
const TASK_DELETABLE: readonly TaskStatus[] = ['CANCELLED', 'COMPLETED', 'EXPIRED'] as const;

// ========== 类型 ==========
interface TaskOrder {
  id: string;
  title: string;
  price: number;
  images?: string[];
  status: string;
  group: string; // 用于 Tab 过滤（预计算）
  role: 'publisher' | 'accepter';
  createdAt: string;
}

interface MyTaskItem {
  id: string;
  title: string;
  price: string;
  status: TaskStatus;
  statusLabel: string;   // 预计算：显示标签
  category: string;
  categoryName: string;
  address: string;
  createdAt: string;
  createdAtLabel: string; // 预计算：显示时间
  canCancel: boolean;     // 预计算
  canDelete: boolean;     // 预计算
}

// ========== 请求版本号（防止竞态：陈旧响应覆盖新数据） ==========
let reqSeq = 0;          // 每次发起请求自增
let currentReqId = 0;    // 当前 Tab 对应的最后一次请求 ID

// ========== 页面实例标记（卸载后丢弃响应） ==========
let mounted = true;

// ========== 状态 ==========
const orders = ref<TaskOrder[]>([]);
const myTasks = ref<MyTaskItem[]>([]);
const ordersLoading = ref(false);
const tasksLoading = ref(false);
const currentTab = ref('');
const page = ref(1);
const hasMore = ref(true);
const orderCounts = ref({ all: 0, pending: 0, accepted: 0, completed: 0 });

/** 当前订单角色过滤：'publisher' | 'helper' | '' (全部) */
const roleFilter = ref<'publisher' | 'helper' | ''>('');

/** 我的发布任务状态过滤 */
const myTaskStatusFilter = ref('');

/** 我的发布子状态筛选 */
const taskStatusFilters = [
  { value: '', label: '全部' },
  { value: 'OPEN', label: '已报价' },
  { value: 'IN_PROGRESS', label: '进行中' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'CANCELLED', label: '已取消' },
];

// ========== 计算属性 ==========
const isOrderView = computed(() => currentTab.value !== MY_TAB);
const isMyTasksView = computed(() => currentTab.value === MY_TAB);

const showLoading = computed(() => {
  if (isOrderView.value) {
    return ordersLoading.value && orders.value.length === 0;
  }
  return tasksLoading.value && myTasks.value.length === 0;
});

const tabs = computed(() => [
  { status: '',             label: '全部',     count: orderCounts.value.all },
  { status: 'PENDING',      label: '已报价',   count: orderCounts.value.pending },
  { status: 'ACCEPTED',     label: '进行中',   count: orderCounts.value.accepted },
  { status: 'COMPLETED',    label: '已完成',   count: orderCounts.value.completed },
]);

const filteredOrders = computed(() => {
  const tab = currentTab.value;
  if (!tab) return orders.value;
  return orders.value.filter(o => o.group === tab);
});

const emptyIcon = computed(() => (isMyTasksView.value ? '📝' : '📋'));
const emptyTitle = computed(() => (isMyTasksView.value ? '暂无发布的任务' : '暂无相关订单'));
const emptyDesc = computed(() => {
  if (isMyTasksView.value) return '发布任务后可在此查看和管理';
  const map: Record<string, string> = {
    '': '还没有任何订单，去首页发布任务吧',
    PENDING: '暂无已报价的订单',
    ACCEPTED: '暂无进行中的订单',
    COMPLETED: '暂无已完成的订单',
  };
  return map[currentTab.value] || '暂无相关订单';
});

// ========== 辅助函数（纯函数，不在模板里调用） ==========
function formatTime(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

/** 统计订单数量（一次性遍历 O(n)，避免 tabs 里多次 filter） */
function tallyOrders(list: TaskOrder[]): { all: number; pending: number; accepted: number; completed: number } {
  let all = 0, pending = 0, accepted = 0, completed = 0;
  for (let i = 0; i < list.length; i++) {
    all++;
    const g = list[i].group;
    if (g === 'PENDING') pending++;
    else if (g === 'ACCEPTED') accepted++;
    else if (g === 'COMPLETED') completed++;
  }
  return { all, pending, accepted, completed };
}

// ========== Tab 切换 ==========
function switchTab(status: string): void {
  if (currentTab.value === status) return;
  currentTab.value = status;
  page.value = 1;
  hasMore.value = true;
  if (status === MY_TAB) {
    myTasks.value = [];
  } else {
    myTaskStatusFilter.value = '';
    orders.value = [];
    orderCounts.value = { all: 0, pending: 0, accepted: 0, completed: 0 };
  }
  triggerLoad();
}

function onTaskStatusFilter(status: string): void {
  if (myTaskStatusFilter.value === status) return;
  myTaskStatusFilter.value = status;
  page.value = 1;
  myTasks.value = [];
  triggerLoad();
}

// ========== 调度加载（版本号机制防竞态） ==========
function triggerLoad(): void {
  if (currentTab.value === MY_TAB) {
    loadMyTasksSafe();
  } else {
    loadOrdersSafe();
  }
}

function refreshCurrent(): void {
  page.value = 1;
  hasMore.value = true;
  if (currentTab.value === MY_TAB) {
    myTasks.value = [];
    loadMyTasksSafe();
  } else {
    orders.value = [];
    orderCounts.value = { all: 0, pending: 0, accepted: 0, completed: 0 };
    loadOrdersSafe();
  }
}

// ========== 订单加载（Safe = 带竞态保护） ==========
async function loadOrdersSafe(): Promise<void> {
  if (ordersLoading.value) return;
  ordersLoading.value = true;
  const reqId = ++reqSeq;
  currentReqId = reqId;

  try {
    const params: { page?: number; pageSize?: number; status?: string } = {
      page: page.value,
      pageSize: PAGE_SIZE,
    };
    const tab = currentTab.value;
    if (tab && tab !== 'ACCEPTED') {
      params.status = tab;
    }
    const data = await paymentApi.getUserOrders(params);

    // 页面已卸载 / 请求已过期 → 丢弃
    if (!mounted || reqId !== currentReqId) return;

    const mappedAll = data.map((o: OrderQueryResult): TaskOrder => {
      const group = ORDER_GROUP_MAP[o.status] || '';
      const uid = userStore.userInfo?.id;
      const role: 'publisher' | 'helper' = uid && o.publisherId === uid ? 'publisher' : 'helper';
      return {
        id: o.id,
        title: o.taskTitle || '任务',
        price: parseFloat(o.totalAmount),
        status: o.status,
        group,
        role,
        createdAt: o.createdAt || '',
      };
    });

    // 按 roleFilter 过滤
    const mapped = roleFilter.value
      ? mappedAll.filter(o => o.role === roleFilter.value)
      : mappedAll;

    if (page.value === 1) {
      orders.value = mapped;
    } else {
      orders.value = [...orders.value, ...mapped];
    }
    // 统一更新一次计数（O(n) 一次遍历）
    orderCounts.value = tallyOrders(orders.value);
    hasMore.value = mapped.length >= PAGE_SIZE;
  } catch {
    if (!mounted || reqId !== currentReqId) return;
    if (page.value === 1) {
      orders.value = [];
      orderCounts.value = { all: 0, pending: 0, accepted: 0, completed: 0 };
    }
    hasMore.value = false;
  } finally {
    if (mounted && reqId === currentReqId) {
      ordersLoading.value = false;
    }
  }
}

// ========== 我的发布加载（Safe = 带竞态保护） ==========
async function loadMyTasksSafe(): Promise<void> {
  if (tasksLoading.value) return;
  tasksLoading.value = true;
  const reqId = ++reqSeq;
  currentReqId = reqId;

  try {
    const params: { page: number; status?: string } = { page: page.value };
    if (myTaskStatusFilter.value) {
      params.status = myTaskStatusFilter.value;
    }
    const data = await taskApi.myTasks(params);

    if (!mounted || reqId !== currentReqId) return;

    const mapped: MyTaskItem[] = data.list.map((t: TaskListItem) => {
      const st = t.status as TaskStatus;
      const categoryName =
        t.category?.name ||
        TASK_CATEGORY_LABELS[t.category as keyof typeof TASK_CATEGORY_LABELS] ||
        '其他';
      return {
        id: t.id,
        title: t.title,
        price: t.price.toFixed(2),
        status: st,
        statusLabel: TASK_STATUS_LABEL[st] || st,
        category: t.category?.code || '',
        categoryName,
        address: t.address,
        createdAt: t.createdAt,
        createdAtLabel: formatTime(t.createdAt),
        canCancel: TASK_CANCELABLE.includes(st),
        canDelete: TASK_DELETABLE.includes(st),
      };
    });

    if (page.value === 1) {
      myTasks.value = mapped;
    } else {
      myTasks.value = [...myTasks.value, ...mapped];
    }
    hasMore.value = data.hasMore;
  } catch {
    if (!mounted || reqId !== currentReqId) return;
    if (page.value === 1) {
      myTasks.value = [];
    }
    hasMore.value = false;
  } finally {
    if (mounted && reqId === currentReqId) {
      tasksLoading.value = false;
    }
  }
}

// ========== 操作 ==========
function goOrderDetail(order: TaskOrder): void {
  tracker.track(EVENTS.PAGE_VIEW, { page: 'order_detail_from_list', orderId: order.id });
  uni.navigateTo({ url: `/pages/order/detail?id=${order.id}` });
}

function goTaskDetail(task: MyTaskItem): void {
  uni.navigateTo({ url: `/pages/task/detail?id=${task.id}` });
}

function onOrderAction(type: string): void {
  tracker.track('order_action', { action: type });
  uni.showToast({ title: `执行操作: ${type}`, icon: 'none' });
}

function onCancelTask(task: MyTaskItem): void {
  uni.showModal({
    title: '取消任务',
    content: `确定取消任务「${task.title}」吗？`,
    confirmColor: '#e53935',
    success: async (res) => {
      if (!res.confirm) return;
      try {
        uni.showLoading({ title: '取消中...' });
        const result = await taskApi.cancel(task.id);
        uni.hideLoading();
        if (result.hasPaidOrder) {
          uni.showModal({
            title: '任务已取消',
            content: '该任务存在已支付订单，请前往订单页申请退款',
            confirmText: '查看订单',
            cancelText: '知道了',
            success: (r) => {
              if (r.confirm) {
                uni.navigateTo({ url: `/pages/order/detail?id=${result.orderId}` });
              }
              refreshCurrent();
            },
          });
        } else {
          uni.showToast({ title: '任务已取消', icon: 'success' });
          refreshCurrent();
        }
      } catch (e) {
        uni.hideLoading();
        uni.showToast({ title: (e as Error).message || '取消失败', icon: 'none' });
      }
    },
  });
}

function onDeleteTask(task: MyTaskItem): void {
  uni.showModal({
    title: '删除任务',
    content: `确定删除任务「${task.title}」吗？删除后不可恢复`,
    confirmColor: '#e53935',
    success: async (res) => {
      if (!res.confirm) return;
      try {
        uni.showLoading({ title: '删除中...' });
        await taskApi.cancel(task.id);
        uni.hideLoading();
        uni.showToast({ title: '已删除', icon: 'success' });
        refreshCurrent();
      } catch (e) {
        uni.hideLoading();
        uni.showToast({ title: (e as Error).message || '删除失败', icon: 'none' });
      }
    },
  });
}

function goPublish(): void {
  uni.navigateTo({ url: '/pages/task/publish' });
}

// ========== 生命周期 ==========
onPullDownRefresh(async () => {
  // 先停止 loading，允许刷新请求进入
  if (currentTab.value === MY_TAB) {
    tasksLoading.value = false;
  } else {
    ordersLoading.value = false;
  }
  await refreshCurrent();
  uni.stopPullDownRefresh();
});

onReachBottom(() => {
  if (!hasMore.value) return;
  if (currentTab.value === MY_TAB) {
    if (tasksLoading.value) return;
  } else {
    if (ordersLoading.value) return;
  }
  page.value++;
  triggerLoad();
});

onLoad((options) => {
  const opts = options as { status?: string; role?: string; tab?: string; taskStatus?: string; title?: string } | undefined;
  const tab = opts?.tab;
  if (tab === MY_TAB) {
    currentTab.value = MY_TAB;
    if (opts?.taskStatus) {
      myTaskStatusFilter.value = opts.taskStatus;
    }
  } else {
    currentTab.value = opts?.status || '';
  }
  if (opts?.role === 'publisher' || opts?.role === 'helper') {
    roleFilter.value = opts.role;
  } else {
    roleFilter.value = '';
  }
  // 动态设置导航标题
  if (opts?.title) {
    uni.setNavigationBarTitle({ title: opts.title });
  } else if (roleFilter.value === 'helper') {
    uni.setNavigationBarTitle({ title: '我接的订单' });
  } else if (roleFilter.value === 'publisher') {
    uni.setNavigationBarTitle({ title: '我的发布任务' });
  } else {
    uni.setNavigationBarTitle({ title: '订单列表' });
  }
  page.value = 1;
  triggerLoad();
});

onMounted(() => {
  mounted = true;
  tracker.track(EVENTS.PAGE_VIEW, { page: 'order_list', status: currentTab.value });
});

onUnload(() => {
  // 标记卸载：后续的请求响应会被直接丢弃，防止内存访问
  mounted = false;
});

// 防止 getCurrentInstance 警告：显式读取实例作用域
void getCurrentInstance();
</script>

<style lang="scss" scoped>
.order-list-page {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding-bottom: env(safe-area-inset-bottom);
}

// Tab 栏
.tabs-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  background-color: #fff;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);
}

.tabs-scroll {
  white-space: nowrap;
}

.tab-item {
  display: inline-flex;
  align-items: center;
  padding: 28rpx 28rpx;
  position: relative;

  .tab-label {
    font-size: 28rpx;
    color: #666;
  }

  &.active {
    .tab-label {
      color: #4caf50;
      font-weight: 600;
      font-size: 30rpx;
    }
  }
}

.tab-badge {
  display: inline-block;
  min-width: 32rpx;
  height: 32rpx;
  line-height: 32rpx;
  padding: 0 8rpx;
  background-color: #f44336;
  color: #fff;
  font-size: 20rpx;
  border-radius: 16rpx;
  text-align: center;
}

// 子状态筛选
.sub-filter-bar {
  display: flex;
  gap: 16rpx;
  padding: 16rpx 24rpx;
  background-color: #fff;
  border-bottom: 1rpx solid #f0f0f0;
}

.sub-filter-item {
  padding: 10rpx 24rpx;
  background-color: #f5f5f5;
  border-radius: 28rpx;
  transition: all 0.2s;

  &.active {
    background-color: #4caf50;
  }

  .sub-filter-label {
    font-size: 24rpx;
    color: #666;
  }

  &.active .sub-filter-label {
    color: #fff;
  }
}

.tab-indicator {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 48rpx;
  height: 6rpx;
  background-color: #4caf50;
  border-radius: 3rpx;
}

// 订单列表
.order-list {
  padding-top: 16rpx;
}

// 任务列表
.task-list {
  padding: 16rpx 24rpx 0;
}

.task-card {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 16rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12rpx;
}

.task-title {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  color: #333;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.task-status {
  font-size: 24rpx;
  padding: 4rpx 16rpx;
  border-radius: 20rpx;
  margin-left: 12rpx;
  flex-shrink: 0;

  &.status-OPEN {
    color: #ff9800;
    background-color: #fff3e0;
  }
  &.status-ASSIGNED {
    color: #2196f3;
    background-color: #e3f2fd;
  }
  &.status-IN_PROGRESS {
    color: #4caf50;
    background-color: #e8f5e9;
  }
  &.status-COMPLETED {
    color: #9e9e9e;
    background-color: #f5f5f5;
  }
  &.status-CANCELLED {
    color: #9e9e9e;
    background-color: #f5f5f5;
  }
  &.status-PRICE_PENDING {
    color: #ff5722;
    background-color: #fbe9e7;
  }
  &.status-EXPIRED {
    color: #9e9e9e;
    background-color: #f5f5f5;
  }
}

.task-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16rpx;
}

.task-category {
  font-size: 24rpx;
  color: #888;
  background-color: #f5f5f5;
  padding: 4rpx 16rpx;
  border-radius: 8rpx;
}

.task-price {
  font-size: 32rpx;
  font-weight: 700;
  color: #ff5722;
}

.task-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 16rpx;
  border-top: 1rpx solid #f5f5f5;
}

.task-time {
  font-size: 24rpx;
  color: #bbb;
}

.task-actions {
  display: flex;
  gap: 16rpx;
}

.action-btn {
  font-size: 26rpx;
  padding: 8rpx 24rpx;
  border-radius: 28rpx;

  &.cancel-btn {
    color: #ff9800;
    background-color: #fff8e1;
  }

  &.delete-btn {
    color: #e53935;
    background-color: #ffebee;
  }
}

// 列表底部
.list-footer {
  display: flex;
  justify-content: center;
  padding: 40rpx 0;
}

.footer-text {
  font-size: 24rpx;
  color: #bbb;
}

// 加载状态
.state-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 200rpx;
  gap: 24rpx;
}

.loading-spinner {
  width: 60rpx;
  height: 60rpx;
  border: 4rpx solid #e0e0e0;
  border-top-color: #4caf50;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  font-size: 28rpx;
  color: #999;
}

// 空状态
.state-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 240rpx;
  gap: 20rpx;
}

.empty-icon {
  font-size: 120rpx;
}

.empty-title {
  font-size: 32rpx;
  color: #333;
  font-weight: 500;
}

.empty-desc {
  font-size: 26rpx;
  color: #999;
}

.empty-btn {
  margin-top: 28rpx;
  background-color: #4caf50;
  color: #fff;
  font-size: 26rpx;

  &::after {
    border: none;
  }
}
</style>