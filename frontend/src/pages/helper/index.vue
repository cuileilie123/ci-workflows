<template>
  <scroll-view class="helper-page" scroll-y>
    <!-- 今日数据 -->
    <view class="today-stats">
      <view class="stat-item">
        <text class="stat-value">{{ todayCount }}</text>
        <text class="stat-label">今日接单</text>
      </view>
      <view class="stat-divider"></view>
      <view class="stat-item">
        <text class="stat-value">¥{{ todayIncome }}</text>
        <text class="stat-label">今日收入</text>
      </view>
      <view class="stat-divider"></view>
      <view class="stat-item">
        <text class="stat-value">{{ completionRate }}%</text>
        <text class="stat-label">完成率</text>
      </view>
    </view>

    <!-- 附近已报价任务 -->
    <view class="section-title">附近已报价</view>
    <view v-if="nearbyTasks.length" class="task-list">
      <task-card
        v-for="t in nearbyTasks"
        :key="t.id"
        :item="t as any"
        compact
      />
    </view>
    <view v-else class="empty-section">
      <text class="empty-text">暂无附近待接任务</text>
    </view>

    <!-- 我的接单 -->
    <view class="section-title">我的接单</view>
    <order-card
      v-for="o in myOrders"
      :key="o.id"
      :order="o"
      @click="goOrderDetail"
      @action="onOrderAction"
    />
    <view v-if="myOrders.length === 0" class="empty-section">
      <text class="empty-text">暂无接单记录</text>
    </view>
  </scroll-view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import OrderCard from '@/components/order-card/order-card.vue';
import TaskCard from '@/components/task-card/task-card.vue';
import { taskApi } from '@/api/task';
import { paymentApi } from '@/api/payment';
import { walletApi } from '@/api/wallet';
import type { TaskListItem } from '@/types';
import { tracker, EVENTS } from '@/utils/track';

interface TaskOrder {
  id: string;
  title: string;
  price: number;
  images?: string[];
  status: string;
  role: 'publisher' | 'accepter';
  createdAt: string;
}

const todayCount = ref(0);
const todayIncome = ref('0.00');
const completionRate = ref(100);

const nearbyTasks = ref<TaskListItem[]>([]);
const myOrders = ref<TaskOrder[]>([]);

// 获取用户位置
async function getUserLocation(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    uni.getLocation({
      type: 'gcj02',
      success: (res) => {
        resolve({ lat: res.latitude, lng: res.longitude });
      },
      fail: () => {
        // 默认使用北京市中心坐标
        resolve({ lat: 39.9042, lng: 116.4074 });
      },
    });
  });
}

async function loadNearbyTasks(): Promise<void> {
  try {
    const location = await getUserLocation();
    if (!location) return;
    
    const res = await taskApi.listNearby({ lat: location.lat, lng: location.lng, page: 1 });
    nearbyTasks.value = res.list.filter(t => t.status === 'OPEN');
  } catch {
    nearbyTasks.value = [];
  }
}

async function loadMyOrders(): Promise<void> {
  try {
    // 订单不存在 ACCEPTED 状态；帮助者进行中的订单 = PAID/IN_PROGRESS
    const ordersData = await paymentApi.getUserOrders({ status: 'IN_PROGRESS' });
    // 如果没有 IN_PROGRESS 的，再补充 PAID（已支付但未开始）的订单
    const paidOrders = ordersData.length
      ? []
      : (await paymentApi.getUserOrders({ status: 'PAID' })).filter(
          (o) => !ordersData.find((x) => x.id === o.id),
        );
    const merged = [...ordersData, ...paidOrders];
    myOrders.value = merged.map((order) => ({
      id: order.id,
      title: order.taskTitle || '任务',
      price: parseFloat(order.totalAmount),
      status: order.status,
      role: 'accepter',
      createdAt: order.createdAt || '',
    }));
  } catch {
    myOrders.value = [];
  }
}

async function loadStats(): Promise<void> {
  try {
    // 今日 0 点时间戳（本地时区）
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0, 0, 0,
    ).getTime();

    // 1) 今日收入：从钱包流水筛选「今日 + INCOME 类型」求和
    let income = 0;
    try {
      const { items } = await walletApi.getTransactions(1, 50, 'INCOME');
      for (const tx of items) {
        const t = new Date(tx.createdAt).getTime();
        if (t >= todayStart) income += Number(tx.amount) || 0;
      }
    } catch {
      // 流水接口失败时保持 0
    }
    todayIncome.value = income.toFixed(2);

    // 2) 今日完成订单数：所有 COMPLETED 订单中 createdAt 属于今日的
    const completedOrders = await paymentApi.getUserOrders({ status: 'COMPLETED' });
    let todayDone = 0;
    for (const o of completedOrders) {
      const t = new Date(o.createdAt || 0).getTime();
      if (t >= todayStart) todayDone++;
    }
    todayCount.value = todayDone;

    // 3) 完成率 = 最近 30 天内完成的订单 / 最近 30 天内所有订单（避免历史数据拉低）
    const allOrders = await paymentApi.getUserOrders();
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = allOrders.filter((o) => new Date(o.createdAt || 0).getTime() >= thirtyDaysAgo);
    if (recent.length > 0) {
      const done = recent.filter((o) => o.status === 'COMPLETED' || o.status === 'REFUNDED').length;
      completionRate.value = Math.round((done / recent.length) * 100);
    }
  } catch {
    todayCount.value = 0;
    todayIncome.value = '0.00';
    completionRate.value = 100;
  }
}

function goOrderDetail(order: TaskOrder): void {
  uni.navigateTo({ url: `/pages/order/detail?id=${order.id}` });
}

function onOrderAction(type: string): void {
  tracker.track('order_action', { action: type, page: 'helper' });
  uni.showToast({ title: `执行操作: ${type}`, icon: 'none' });
}

onShow(async () => {
  tracker.track(EVENTS.PAGE_VIEW, { page: 'helper_center' });
  await Promise.all([loadStats(), loadNearbyTasks(), loadMyOrders()]);
});
</script>

<style lang="scss" scoped>
.helper-page {
  min-height: 100vh;
  padding: 24rpx;
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  background-color: #f5f5f5;
}

.today-stats {
  display: flex;
  align-items: center;
  padding: 40rpx 32rpx;
  background: linear-gradient(135deg, #4caf50, #2e7d32);
  border-radius: 20rpx;
  color: #fff;
}

.stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}

.stat-value {
  font-size: 40rpx;
  font-weight: 700;
}

.stat-label {
  font-size: 24rpx;
  opacity: 0.85;
}

.stat-divider {
  width: 1rpx;
  height: 60rpx;
  background-color: rgba(255, 255, 255, 0.3);
}

.section-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #333;
  margin: 32rpx 0 20rpx;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.empty-section {
  display: flex;
  justify-content: center;
  padding: 80rpx 0;
}

.empty-text {
  font-size: 28rpx;
  color: #999;
}
</style>
