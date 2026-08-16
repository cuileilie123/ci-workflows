<template>
  <scroll-view class="profile-page" scroll-y>
    <!-- 用户信息头部 -->
    <view class="header">
      <view class="avatar-wrap" @click="onAvatarClick">
        <image v-if="user?.avatar" :src="user.avatar" class="avatar" mode="aspectFill" />
        <view v-else class="avatar avatar-placeholder">{{ initial }}</view>
      </view>
      <view class="user-info">
        <text class="nickname">{{ user?.nickname || '未设置昵称' }}</text>
        <view class="credit-row">
          <text class="credit-label">信用分</text>
          <text class="credit-score-text">{{ credit.score }}</text>
        </view>
      </view>
    </view>

    <!-- 认证状态卡片（未全部完成时显示） -->
    <view v-if="!verification.canUseCoreFeatures" class="verify-card" @click="goVerification">
      <view class="verify-head">
        <text class="verify-icon">🛡️</text>
        <view class="verify-info">
          <text class="verify-title">完成认证以使用全部功能</text>
          <text class="verify-desc">发布任务、接单、提现需完成认证</text>
        </view>
        <text class="verify-arrow">›</text>
      </view>
      <view class="verify-steps">
        <view class="vs-item">
          <text class="vs-dot" :class="{ done: verification.phoneBound }">{{ verification.phoneBound ? '✓' : '○' }}</text>
          <text class="vs-label">手机号</text>
        </view>
        <view class="vs-item">
          <text class="vs-dot" :class="{ done: verification.realNameVerified }">{{ verification.realNameVerified ? '✓' : '○' }}</text>
          <text class="vs-label">实名</text>
        </view>
        <view class="vs-item">
          <text class="vs-dot" :class="{ done: verification.bankCardBound }">{{ verification.bankCardBound ? '✓' : '○' }}</text>
          <text class="vs-label">银行卡</text>
        </view>
      </view>
    </view>

    <!-- 钱包卡片 -->
    <view class="wallet-card" @click="goWallet">
      <view class="wallet-row">
        <text class="label">可用余额</text>
        <text class="amount">¥{{ balance.available.toFixed(2) }}</text>
      </view>
      <view class="wallet-row">
        <text class="label">冻结中</text>
        <text class="frozen">¥{{ balance.frozen.toFixed(2) }}</text>
      </view>
      <button class="withdraw-btn" @click.stop="goWithdraw">提现</button>
    </view>

    <!-- 我的订单入口 -->
    <view class="order-entries">
      <!-- 我接的订单 -->
      <view class="entries-section">
        <view class="entries-header" @click="goOrderList('', 'helper')">
          <text class="entries-title">🤝 我接的订单</text>
          <text class="entries-subtitle">{{ helperOrderCount }}笔</text>
          <text class="entries-arrow">›</text>
        </view>
      </view>

      <view class="entries-divider" />

      <!-- 我的发布任务 -->
      <view class="entries-section">
        <view class="entries-header" @click="goTaskList()">
          <text class="entries-title">📝 我的发布任务</text>
          <text class="entries-subtitle">{{ myTaskCount }}个</text>
          <text class="entries-arrow">›</text>
        </view>
      </view>
    </view>

    <!-- 财务设置直达入口（仅老板级账号可见，免进二级菜单） -->
    <view v-if="perm.isBoss" class="finance-entry" @click="goFinanceSettings">
      <text class="finance-icon">🏦</text>
      <view class="finance-info">
        <text class="finance-title">财务设置</text>
        <text class="finance-desc">配置平台佣金收款账号（分账接收方）</text>
      </view>
      <text class="menu-arrow">›</text>
    </view>

    <!-- 中端管理入口（仅老板/拥有权限的工作人员可见） -->
    <view v-if="perm.hasAnyAdminEntry" class="admin-entry" @click="goAdmin">
      <text class="admin-icon">🛠️</text>
      <view class="admin-info">
        <text class="admin-title">中端管理</text>
        <text class="admin-desc">{{ perm.isBoss ? '老板后台：分佣 / 改价 / 分类 / 权限' : '工作人员后台' }}</text>
      </view>
      <text class="menu-arrow">›</text>
    </view>

    <!-- 待确认改价提醒（仅发布者且有待确认改价时显示） -->
    <view v-if="pendingPriceChanges.length" class="price-pending-card">
      <view class="pp-head">
        <text class="pp-title">待确认改价</text>
        <text class="pp-count">{{ pendingPriceChanges.length }} 笔</text>
      </view>
      <view
        v-for="item in pendingPriceChanges"
        :key="item.id"
        class="pp-item"
        @click="goTaskDetail(item.taskId)"
      >
        <view class="pp-item-info">
          <text class="pp-item-title">{{ item.taskTitle }}</text>
          <text class="pp-item-meta">¥{{ item.oldPrice.toFixed(2) }} → ¥{{ item.newPrice.toFixed(2) }}</text>
        </view>
        <text class="pp-arrow">›</text>
      </view>
    </view>

    <!-- 设置入口 -->
    <view class="settings">
      <view class="menu-item" @click="goVerification">
        <text class="menu-icon">🛡️</text>
        <text class="menu-label">认证中心</text>
        <text v-if="!verification.canUseCoreFeatures" class="menu-badge">待完善</text>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @click="goReviews">
        <text class="menu-icon">⭐</text>
        <text class="menu-label">我的评价</text>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @click="goSettings">
        <text class="menu-icon">⚙️</text>
        <text class="menu-label">设置</text>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @click="goHelp">
        <text class="menu-icon">❓</text>
        <text class="menu-label">帮助中心</text>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @click="goChat">
        <text class="menu-icon">💬</text>
        <text class="menu-label">联系客服</text>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @click="goAbout">
        <text class="menu-icon">ℹ️</text>
        <text class="menu-label">关于</text>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item logout" @click="handleLogout">
        <text class="menu-icon">🚪</text>
        <text class="menu-label">退出登录</text>
      </view>
    </view>
  </scroll-view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useUserStore } from '@/store/user';
import { usePermissionStore } from '@/store/permission';
import { reviewApi, type CreditDetail } from '@/api/review';
import { walletApi, type WalletBalance } from '@/api/wallet';
import { paymentApi } from '@/api/payment';
import { taskApi } from '@/api/task';
import { priceChangeApi } from '@/api/admin';
import { chatApi } from '@/api/chat';
import { verificationApi } from '@/api/verification';
import { tracker, EVENTS } from '@/utils/track';
import type { PendingPriceChange, VerificationStatus } from '@/types';

const userStore = useUserStore();
const user = computed(() => userStore.userInfo);
const perm = usePermissionStore();

const pendingPriceChanges = ref<PendingPriceChange[]>([]);

const credit = ref<CreditDetail>({
  score: 100,
  level: '良好',
  totalReviews: 0,
  avgRating: 0,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  completedCount: 0,
});

const balance = ref<WalletBalance>({
  id: '',
  balance: 0,
  frozen: 0,
  available: 0,
});

const verification = ref<VerificationStatus>({
  phoneBound: false,
  bankCardBound: false,
  realNameVerified: false,
  phone: null,
  realName: null,
  bankCardCount: 0,
  canUseCoreFeatures: false,
  canWithdraw: false,
});

const initial = computed(() => user.value?.nickname?.[0] || 'U');

// 订单相关
const helperOrderCount = ref(0);
const myTaskCount = ref(0);

function goOrderList(status: string, role: 'publisher' | 'helper'): void {
  const params = [`role=${role}`];
  if (status) params.push(`status=${status}`);
  if (role === 'helper') params.push('title=我接的订单');
  uni.navigateTo({ url: `/pages/order/list?${params.join('&')}` });
}

function goTaskList(status?: string): void {
  const params = ['role=publisher', 'title=我的发布任务'];
  if (status) params.push(`status=${status}`);
  uni.navigateTo({ url: `/pages/order/list?${params.join('&')}` });
}

// 加载数据
async function loadCredit(): Promise<void> {
  const uid = user.value?.id;
  if (!uid) return;
  try {
    credit.value = await reviewApi.getCredit(uid);
  } catch {
    // 使用默认值
  }
}

async function loadBalance(): Promise<void> {
  try {
    balance.value = await walletApi.getBalance();
  } catch {
    // 使用默认值
  }
}

async function loadVerification(): Promise<void> {
  try {
    verification.value = await verificationApi.getStatus();
  } catch {
    // 使用默认值
  }
}

async function loadOrders(): Promise<void> {
  const uid = user.value?.id;
  if (!uid) return;
  try {
    const ordersData = await paymentApi.getUserOrders();
    helperOrderCount.value = ordersData.filter(o => o.publisherId !== uid).length;
  } catch {
    helperOrderCount.value = 0;
  }
}

async function loadMyTaskCount(): Promise<void> {
  try {
    const data = await taskApi.myTasks({ page: 1 });
    myTaskCount.value = data.total || data.list?.length || 0;
  } catch {
    myTaskCount.value = 0;
  }
}

// 路由跳转
function goWallet(): void {
  tracker.track(EVENTS.PAGE_VIEW, { page: 'wallet_entry' });
  uni.navigateTo({ url: '/pages/user/wallet' });
}

function goVerification(): void {
  uni.navigateTo({ url: '/pages/user/verification' });
}

function goAdmin(): void {
  uni.navigateTo({ url: '/pages/admin/index' });
}

function goFinanceSettings(): void {
  uni.navigateTo({ url: '/pages/admin/finance-settings' });
}

function goTaskDetail(taskId: string): void {
  uni.navigateTo({ url: `/pages/task/detail?id=${taskId}` });
}

async function loadPendingPriceChanges(): Promise<void> {
  try {
    pendingPriceChanges.value = await priceChangeApi.listPending();
  } catch {
    pendingPriceChanges.value = [];
  }
}

function goWithdraw(): void {
  uni.navigateTo({ url: '/pages/user/wallet' });
}

function goReviews(): void {
  uni.navigateTo({ url: '/pages/user/reviews' });
}

function goSettings(): void {
  uni.navigateTo({ url: '/pages/user/settings' });
}

function goHelp(): void {
  uni.showToast({ title: '帮助中心即将上线', icon: 'none' });
}

async function goChat(): Promise<void> {
  uni.showLoading({ title: '正在连接客服...' });
  try {
    const cs = await chatApi.findCustomerService();
    uni.hideLoading();
    if (cs && cs.userId) {
      uni.navigateTo({
        url: `/pages/chat/chat?peerId=${cs.userId}&peerNickname=${encodeURIComponent(cs.nickname)}&peerAvatar=${encodeURIComponent(cs.avatar ?? '')}`,
      });
    } else {
      uni.showToast({ title: '暂无在线客服，请稍后再试', icon: 'none' });
    }
  } catch (e) {
    uni.hideLoading();
    uni.showToast({ title: (e as Error).message || '连接客服失败', icon: 'none' });
  }
}

function goAbout(): void {
  uni.showToast({ title: '版本 v1.0.0', icon: 'none' });
}

function handleLogout(): void {
  uni.showModal({
    title: '提示',
    content: '确定要退出登录吗？',
    success: async (res) => {
      if (res.confirm) {
        await userStore.logout();
        uni.reLaunch({ url: '/pages/index/index' });
      }
    },
  });
}

function onAvatarClick(): void {
  uni.showToast({ title: '头像修改即将上线', icon: 'none' });
}

onShow(async (): Promise<void> => {
  // 检查登录状态
  if (!userStore.isLoggedIn) {
    uni.showModal({
      title: '提示',
      content: '请先登录后再访问个人中心',
      showCancel: false,
      success: () => {
        uni.reLaunch({ url: '/pages/auth/login' });
      },
    });
    return;
  }

  tracker.track(EVENTS.PAGE_VIEW, { page: 'user_profile' });
  await userStore.fetchMe();
  await perm.load().catch(() => undefined);
  await Promise.all([loadCredit(), loadBalance(), loadVerification(), loadOrders(), loadMyTaskCount(), loadPendingPriceChanges()]);
});
</script>

<style lang="scss" scoped>
.profile-page {
  min-height: 100vh;
  padding: 24rpx;
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
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

.credit-row {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.credit-label {
  font-size: 24rpx;
  color: #888;
}

.credit-score-text {
  font-size: 28rpx;
  font-weight: 600;
  color: #4caf50;
}

// 认证状态卡片
.verify-card {
  margin-top: 24rpx;
  padding: 28rpx;
  background: linear-gradient(135deg, #ff9800, #f57c00);
  border-radius: 20rpx;
  color: #fff;
}

.verify-head {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.verify-icon {
  font-size: 44rpx;
}

.verify-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.verify-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #fff;
}

.verify-desc {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.85);
}

.verify-arrow {
  font-size: 36rpx;
  color: rgba(255, 255, 255, 0.7);
}

.verify-steps {
  display: flex;
  gap: 40rpx;
  margin-top: 24rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid rgba(255, 255, 255, 0.2);
}

.vs-item {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.vs-dot {
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.6);

  &.done {
    color: #fff;
  }
}

.vs-label {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.9);
}

// 钱包卡片
.wallet-card {
  margin-top: 24rpx;
  padding: 32rpx;
  background: linear-gradient(135deg, #4caf50, #2e7d32);
  border-radius: 20rpx;
  color: #fff;
}

.wallet-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16rpx;

  &:last-of-type {
    margin-bottom: 24rpx;
  }
}

.label {
  font-size: 26rpx;
  opacity: 0.85;
}

.amount {
  font-size: 44rpx;
  font-weight: 700;
}

.frozen {
  font-size: 32rpx;
}

.withdraw-btn {
  width: 100%;
  padding: 20rpx 0;
  background-color: rgba(255, 255, 255, 0.25);
  border-radius: 30rpx;
  border: none;
  color: #fff;
  font-size: 30rpx;
  font-weight: 500;
  margin: 0;
  line-height: 1.5;

  &::after {
    border: none;
  }
}

// 订单入口卡片
.order-entries {
  margin-top: 24rpx;
  background-color: #fff;
  border-radius: 20rpx;
  overflow: hidden;
}

.entries-section {
  padding: 0 28rpx;
}

.entries-divider {
  height: 1rpx;
  background-color: #f0f0f0;
  margin: 0 28rpx;
}

.entries-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24rpx 0;
}

.entries-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #333;
}

.entries-subtitle {
  font-size: 24rpx;
  color: #999;
  margin: 0 12rpx;
  flex: 1;
}

.entries-arrow {
  color: #ccc;
  font-size: 36rpx;
}

// 设置入口
.settings {
  margin-top: 24rpx;
  background-color: #fff;
  border-radius: 20rpx;
  overflow: hidden;
}

// 财务设置直达入口
.finance-entry {
  margin-top: 24rpx;
  padding: 28rpx;
  background: linear-gradient(135deg, #ff9800, #f57c00);
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  gap: 20rpx;
  color: #fff;
}

.finance-icon {
  font-size: 44rpx;
}

.finance-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.finance-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #fff;
}

.finance-desc {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.85);
}

// 中端管理入口
.admin-entry {
  margin-top: 24rpx;
  padding: 28rpx;
  background: linear-gradient(135deg, #5c6bc0, #3949ab);
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  gap: 20rpx;
  color: #fff;
}

.admin-icon {
  font-size: 44rpx;
}

.admin-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.admin-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #fff;
}

.admin-desc {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.8);
}

// 待确认改价卡片
.price-pending-card {
  margin-top: 24rpx;
  padding: 24rpx;
  background-color: #fff;
  border-radius: 20rpx;
  border-left: 8rpx solid #ff9800;
}

.pp-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16rpx;
}

.pp-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #333;
}

.pp-count {
  font-size: 24rpx;
  color: #ff9800;
  font-weight: 600;
}

.pp-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16rpx 0;
  border-top: 1rpx solid #f5f5f5;
}

.pp-item-info {
  flex: 1;
}

.pp-item-title {
  display: block;
  font-size: 28rpx;
  color: #333;
  margin-bottom: 4rpx;
}

.pp-item-meta {
  font-size: 24rpx;
  color: #ff9800;
}

.pp-arrow {
  color: #ccc;
  font-size: 36rpx;
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

  &.logout {
    .menu-label {
      color: #f44336;
    }
  }
}

.menu-item.logout {
  background: #f44336;
  background: linear-gradient(135deg, #f44336, #d32f2f);
  border-radius: 12rpx;
  margin: 12rpx 28rpx;
  box-shadow: 0 4rpx 12rpx rgba(244, 67, 54, 0.3);
  position: relative;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}

.menu-item.logout::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  transition: left 0.5s;
}

.menu-item.logout:active::before,
.menu-item.logout.pressed::before {
  left: 100%;
}

/* 为触摸设备添加兼容性 */
.menu-item.logout:active {
  transform: scale(0.98);
  transition: transform 0.1s;
}

.menu-item.logout .menu-label {
  color: #fff;
  font-weight: 600;
}

.menu-item.logout .menu-icon {
  color: #fff;
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

.menu-badge {
  font-size: 22rpx;
  color: #fff;
  background-color: #ff9800;
  padding: 4rpx 16rpx;
  border-radius: 16rpx;
  margin-right: 8rpx;
}
</style>
