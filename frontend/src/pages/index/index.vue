<template>
  <view class="container">
    <view class="header">
      <text class="title">邻里互助</text>
      <text class="subtitle">社区有偿互助平台</text>
    </view>

    <view class="card">
      <text class="card-title">快速开始</text>
      <view class="feature-list">
        <text class="feature-item">发布任务，邻里帮办</text>
        <text class="feature-item">接单赚钱，信用担保</text>
        <text class="feature-item">微信支付，安全可靠</text>
      </view>
    </view>

    <view class="action-row">
      <button class="action-btn nearby-btn" @click="onNearby">附近任务</button>
      <button class="action-btn publish-btn" @click="onPublish">
        <text class="publish-icon">+</text> 发布任务
      </button>
    </view>

    <view class="footer">
      <text class="version">v0.1.0</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { useUserStore } from '@/store/user';
import { tracker, EVENTS } from '@/utils/track';
import { requireVerification } from '@/utils/verification';
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';

const userStore = useUserStore();

// 页面访问埋点
onShow(() => {
  tracker.track(EVENTS.APP_LAUNCH, { page: 'index' });
});

// 页面停留时长埋点
let cleanupPageView: (() => void) | null = null;
onLoad(() => {
  cleanupPageView = tracker.trackPageView('index');
});

onUnload(() => {
  cleanupPageView?.();
  cleanupPageView = null;
});

async function onPublish(): Promise<void> {
  if (!userStore.isLoggedIn) {
    uni.showToast({ title: '请先登录', icon: 'none' });
    uni.reLaunch({ url: '/pages/auth/login' });
    return;
  }
  // 前置校验：须完成手机号绑定、银行卡绑定、实名认证
  const ok = await requireVerification('发布任务');
  if (!ok) return;
  uni.navigateTo({ url: '/pages/task/publish' });
}

function onNearby(): void {
  uni.switchTab({ url: '/pages/task/list' });
}
</script>

<style lang="scss" scoped>
.container {
  padding: 32rpx;
  min-height: 100vh;
  background-color: #f8f8f8;
}

.header {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60rpx 0 40rpx;
}

.title {
  font-size: 48rpx;
  font-weight: bold;
  color: #333;
}

.subtitle {
  font-size: 28rpx;
  color: #666;
  margin-top: 12rpx;
}

.card {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 32rpx;
  margin-top: 40rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.08);
}

.card-title {
  font-size: 32rpx;
  font-weight: bold;
  color: #333;
  margin-bottom: 24rpx;
}

.feature-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.feature-item {
  font-size: 28rpx;
  color: #555;
  padding-left: 24rpx;
  position: relative;

  &::before {
    content: '✓';
    color: #4caf50;
    position: absolute;
    left: 0;
  }
}

.footer {
  display: flex;
  justify-content: center;
  padding: 60rpx 0;
}

.version {
  font-size: 24rpx;
  color: #999;
}

.action-row {
  display: flex;
  gap: 20rpx;
  margin-top: 40rpx;
}

.action-btn {
  flex: 1;
  height: 92rpx;
  line-height: 92rpx;
  font-size: 30rpx;
  border-radius: 46rpx;
  margin: 0;

  &::after {
    border: none;
  }
}

.nearby-btn {
  background-color: #fff;
  color: #4caf50;
  border: 2rpx solid #4caf50;
  box-sizing: border-box;
}

.publish-btn {
  flex: 1.4;
  background: #4caf50;
  background: linear-gradient(135deg, #4caf50, #2e7d32);
  color: #fff;
  box-shadow: 0 4rpx 12rpx rgba(76, 175, 80, 0.3);
  position: relative;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}

.publish-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  transition: left 0.5s;
}

.publish-btn:active::before,
.publish-btn.pressed::before {
  left: 100%;
}

/* 为触摸设备添加兼容性 */
.publish-btn:active {
  transform: scale(0.98);
  transition: transform 0.1s;
}

.publish-icon {
  display: inline-block;
  width: 44rpx;
  height: 44rpx;
  line-height: 44rpx;
  text-align: center;
  background-color: rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  font-size: 24rpx;
  margin-right: 12rpx;
  font-weight: bold;
}
</style>
