<template>
  <scroll-view class="verification-page" scroll-y>
    <!-- 说明卡片 -->
    <view class="notice-card">
      <text class="notice-title">完成认证后即可使用全部功能</text>
      <text class="notice-desc">发布任务、接单赚钱、钱包提现均需完成以下三项认证</text>
    </view>

    <!-- 步骤 1：手机号绑定 -->
    <view class="step-card">
      <view class="step-header">
        <view class="step-left">
          <view class="step-num" :class="{ done: status.phoneBound }">
            <text v-if="status.phoneBound" class="check">✓</text>
            <text v-else>1</text>
          </view>
          <view class="step-info">
            <text class="step-title">手机号绑定</text>
            <text class="step-desc">{{ status.phone ? status.phone : '用于账号安全与通知' }}</text>
          </view>
        </view>
        <text v-if="status.phoneBound" class="step-status done">已绑定</text>
        <!-- 微信获取手机号按钮 -->
        <button
          v-else
          class="step-btn"
          open-type="getPhoneNumber"
          @getphonenumber="onGetPhoneNumber"
        >
          绑定
        </button>
      </view>
    </view>

    <!-- 步骤 2：实名认证 -->
    <view class="step-card">
      <view class="step-header">
        <view class="step-left">
          <view class="step-num" :class="{ done: status.realNameVerified }">
            <text v-if="status.realNameVerified" class="check">✓</text>
            <text v-else>2</text>
          </view>
          <view class="step-info">
            <text class="step-title">实名认证</text>
            <text class="step-desc">{{ status.realName ? status.realName : '绑定银行卡的前置条件' }}</text>
          </view>
        </view>
        <text v-if="status.realNameVerified" class="step-status done">已认证</text>
        <view v-else class="step-btn" @click="goRealName">
          <text class="step-btn-text">去认证</text>
        </view>
      </view>
    </view>

    <!-- 步骤 3：银行卡绑定 -->
    <view class="step-card">
      <view class="step-header">
        <view class="step-left">
          <view class="step-num" :class="{ done: status.bankCardBound }">
            <text v-if="status.bankCardBound" class="check">✓</text>
            <text v-else>3</text>
          </view>
          <view class="step-info">
            <text class="step-title">银行卡绑定</text>
            <text class="step-desc">
              {{ status.bankCardBound ? `已绑定 ${status.bankCardCount} 张` : '提现需绑定银行卡' }}
            </text>
          </view>
        </view>
        <text v-if="status.bankCardBound" class="step-status done">已绑定</text>
        <view v-else class="step-btn" :class="{ disabled: !status.realNameVerified }" @click="goBankCard">
          <text class="step-btn-text">去绑定</text>
        </view>
      </view>
      <view v-if="!status.realNameVerified" class="step-tip">
        <text class="tip-text">请先完成实名认证</text>
      </view>
    </view>

    <!-- 银行卡列表入口（已绑定时显示） -->
    <view v-if="status.bankCardBound" class="menu-item" @click="goBankCard">
      <text class="menu-label">管理银行卡</text>
      <text class="menu-arrow">›</text>
    </view>
  </scroll-view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { verificationApi } from '@/api/verification';
import type { VerificationStatus } from '@/types';

const status = ref<VerificationStatus>({
  phoneBound: false,
  bankCardBound: false,
  realNameVerified: false,
  phone: null,
  realName: null,
  bankCardCount: 0,
  canUseCoreFeatures: false,
  canWithdraw: false,
});

async function loadStatus(): Promise<void> {
  try {
    status.value = await verificationApi.getStatus();
  } catch {
    // 使用默认值
  }
}

async function onGetPhoneNumber(e: { detail: { code?: string; errMsg?: string } }): Promise<void> {
  if (e.detail.errMsg && !e.detail.errMsg.includes('ok')) {
    uni.showToast({ title: '已取消手机号授权', icon: 'none' });
    return;
  }
  if (!e.detail.code) {
    uni.showToast({ title: '获取手机号失败，请重试', icon: 'none' });
    return;
  }

  uni.showLoading({ title: '绑定中...' });
  try {
    await verificationApi.bindPhone(e.detail.code);
    uni.showToast({ title: '手机号绑定成功', icon: 'success' });
    await loadStatus();
  } catch (err) {
    uni.showToast({ title: (err as Error).message || '绑定失败', icon: 'none' });
  } finally {
    uni.hideLoading();
  }
}

function goRealName(): void {
  uni.navigateTo({ url: '/pages/user/real-name' });
}

function goBankCard(): void {
  if (!status.value.realNameVerified) {
    uni.showToast({ title: '请先完成实名认证', icon: 'none' });
    return;
  }
  uni.navigateTo({ url: '/pages/user/bank-card' });
}

onShow(() => {
  loadStatus();
});
</script>

<style lang="scss" scoped>
.verification-page {
  min-height: 100vh;
  padding: 24rpx;
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  background-color: #f5f5f5;
}

.notice-card {
  padding: 32rpx 28rpx;
  background: linear-gradient(135deg, #4caf50, #2e7d32);
  border-radius: 20rpx;
  margin-bottom: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.notice-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #fff;
}

.notice-desc {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.85);
}

.step-card {
  background-color: #fff;
  border-radius: 20rpx;
  margin-bottom: 24rpx;
  overflow: hidden;
}

.step-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32rpx 28rpx;
}

.step-left {
  display: flex;
  align-items: center;
  gap: 20rpx;
  flex: 1;
}

.step-num {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background-color: #e0e0e0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  font-weight: 600;
  color: #999;
  flex-shrink: 0;

  &.done {
    background-color: #4caf50;
    color: #fff;
  }
}

.check {
  font-size: 36rpx;
}

.step-info {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  flex: 1;
}

.step-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #333;
}

.step-desc {
  font-size: 24rpx;
  color: #999;
}

.step-status {
  font-size: 26rpx;
  font-weight: 600;

  &.done {
    color: #4caf50;
  }
}

.step-btn {
  padding: 12rpx 32rpx;
  background-color: #4caf50;
  border-radius: 30rpx;
  border: none;
  font-size: 28rpx;
  color: #fff;
  line-height: 1.5;

  &.disabled {
    background-color: #c8e6c9;
  }

  &::after {
    border: none;
  }
}

.step-btn-text {
  font-size: 28rpx;
  color: #fff;
}

.step-tip {
  padding: 0 28rpx 20rpx 112rpx;
}

.tip-text {
  font-size: 22rpx;
  color: #ff9800;
}

.menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 28rpx;
  background-color: #fff;
  border-radius: 20rpx;
}

.menu-label {
  font-size: 30rpx;
  color: #333;
}

.menu-arrow {
  font-size: 36rpx;
  color: #ccc;
}
</style>
