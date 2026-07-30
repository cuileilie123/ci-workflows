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

    <view class="footer">
      <text class="version">v0.1.0</text>
    </view>
  </view>
</template>

<script setup lang="ts">
// 首页 - 后续接入任务列表
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
</style>
