<template>
  <view class="container">
    <view class="header">
      <text class="title">邻里互助</text>
      <text class="subtitle">社区有偿互助平台</text>
    </view>

    <view v-if="userStore.isLoggedIn" class="card user-card">
      <image
        v-if="userStore.avatar"
        class="user-avatar"
        :src="userStore.avatar"
        mode="aspectFill"
      />
      <view v-else class="user-avatar placeholder">
        <text class="placeholder-text">{{ userStore.nickname.slice(0, 1) || '邻' }}</text>
      </view>
      <view class="user-info">
        <text class="user-name">{{ userStore.nickname }}</text>
        <text class="user-meta">信用分：{{ userStore.userInfo?.creditScore ?? 100 }}</text>
      </view>
      <button class="logout-btn" size="mini" @click="onLogout">退出</button>
    </view>

    <view class="card">
      <text class="card-title">快速开始</text>
      <view class="feature-list">
        <text class="feature-item">发布任务，邻里帮办</text>
        <text class="feature-item">接单赚钱，信用担保</text>
        <text class="feature-item">微信支付，安全可靠</text>
      </view>
    </view>

    <view class="footer">
      <text class="version">v0.1.0</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { useUserStore } from '@/store/user';

const userStore = useUserStore();

async function onLogout(): Promise<void> {
  await userStore.logout();
  uni.reLaunch({ url: '/pages/auth/login' });
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

.user-card {
  display: flex;
  align-items: center;
}

.user-avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  flex-shrink: 0;

  &.placeholder {
    background-color: #4caf50;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

.placeholder-text {
  color: #fff;
  font-size: 36rpx;
  font-weight: bold;
}

.user-info {
  flex: 1;
  margin-left: 24rpx;
  display: flex;
  flex-direction: column;
}

.user-name {
  font-size: 32rpx;
  font-weight: bold;
  color: #333;
}

.user-meta {
  font-size: 24rpx;
  color: #888;
  margin-top: 8rpx;
}

.logout-btn {
  flex-shrink: 0;
  background-color: #f5f5f5;
  color: #666;
  font-size: 24rpx;

  &::after {
    border: none;
  }
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
</style>
