<template>
  <view class="real-name-page">
    <!-- 已认证状态 -->
    <view v-if="realName && realName.status === 'VERIFIED'" class="verified-card">
      <view class="verified-icon-wrap">
        <text class="verified-icon">✓</text>
      </view>
      <text class="verified-title">实名认证已完成</text>
      <view class="info-row">
        <text class="info-label">姓名</text>
        <text class="info-value">{{ realName.realName }}</text>
      </view>
      <view class="info-row">
        <text class="info-label">身份证号</text>
        <text class="info-value">{{ realName.idCardMasked }}</text>
      </view>
      <text class="verified-tip">实名认证信息不可修改</text>
    </view>

    <!-- 未认证：表单 -->
    <view v-else class="form-card">
      <view class="form-header">
        <text class="form-title">实名认证</text>
        <text class="form-desc">请填写真实姓名和身份证号，信息仅用于身份验证</text>
      </view>

      <view class="field">
        <text class="label">真实姓名</text>
        <input
          v-model="form.realName"
          class="input"
          placeholder="请输入真实姓名（中文）"
          placeholder-class="ph"
          maxlength="32"
        />
      </view>

      <view class="field">
        <text class="label">身份证号</text>
        <input
          v-model="form.idCardNumber"
          class="input"
          placeholder="请输入 18 位身份证号"
          placeholder-class="ph"
          maxlength="18"
        />
      </view>

      <view class="tips-card">
        <text class="tips-title">温馨提示</text>
        <text class="tips-item">• 请确保姓名与身份证号真实有效</text>
        <text class="tips-item">• 认证信息加密存储，仅用于身份核验</text>
        <text class="tips-item">• 完成实名认证后可绑定银行卡</text>
      </view>

      <button class="submit-btn" :disabled="submitting" @click="onSubmit">
        {{ submitting ? '提交中...' : '提交认证' }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { verificationApi } from '@/api/verification';
import type { RealNameInfo } from '@/types';

const realName = ref<RealNameInfo | null>(null);
const submitting = ref(false);

const form = ref({
  realName: '',
  idCardNumber: '',
});

async function loadRealName(): Promise<void> {
  try {
    realName.value = await verificationApi.getRealName();
  } catch {
    realName.value = null;
  }
}

function validate(): boolean {
  if (!form.value.realName.trim()) {
    uni.showToast({ title: '请输入真实姓名', icon: 'none' });
    return false;
  }
  if (!/^[\u4e00-\u9fa5·]{2,32}$/.test(form.value.realName.trim())) {
    uni.showToast({ title: '姓名须为 2-32 位中文', icon: 'none' });
    return false;
  }
  if (!form.value.idCardNumber.trim()) {
    uni.showToast({ title: '请输入身份证号', icon: 'none' });
    return false;
  }
  if (!/^\d{17}[\dXx]$/.test(form.value.idCardNumber.trim())) {
    uni.showToast({ title: '身份证号格式不正确', icon: 'none' });
    return false;
  }
  return true;
}

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  if (!validate()) return;

  submitting.value = true;
  try {
    realName.value = await verificationApi.submitRealName(
      form.value.realName.trim(),
      form.value.idCardNumber.trim().toUpperCase(),
    );
    uni.showToast({ title: '实名认证成功', icon: 'success' });
  } catch (err) {
    uni.showToast({ title: (err as Error).message || '认证失败', icon: 'none' });
  } finally {
    submitting.value = false;
  }
}

onShow(() => {
  loadRealName();
});
</script>

<style lang="scss" scoped>
.real-name-page {
  min-height: 100vh;
  padding: 24rpx;
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  background-color: #f5f5f5;
}

// 已认证卡片
.verified-card {
  background-color: #fff;
  border-radius: 20rpx;
  padding: 48rpx 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
}

.verified-icon-wrap {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background-color: #4caf50;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16rpx;
}

.verified-icon {
  font-size: 56rpx;
  color: #fff;
  font-weight: 700;
}

.verified-title {
  font-size: 34rpx;
  font-weight: 600;
  color: #333;
  margin-bottom: 24rpx;
}

.info-row {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24rpx 0;
  border-bottom: 1rpx solid #f0f0f0;

  &:last-of-type {
    border-bottom: none;
  }
}

.info-label {
  font-size: 28rpx;
  color: #999;
}

.info-value {
  font-size: 30rpx;
  color: #333;
  font-weight: 500;
}

.verified-tip {
  font-size: 24rpx;
  color: #999;
  margin-top: 16rpx;
}

// 表单卡片
.form-card {
  background-color: #fff;
  border-radius: 20rpx;
  padding: 32rpx 28rpx;
}

.form-header {
  margin-bottom: 32rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.form-title {
  font-size: 34rpx;
  font-weight: 600;
  color: #333;
}

.form-desc {
  font-size: 24rpx;
  color: #999;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  margin-bottom: 32rpx;
}

.label {
  font-size: 28rpx;
  color: #333;
  font-weight: 500;
}

.input {
  height: 96rpx;
  border: 2rpx solid #e0e0e0;
  border-radius: 12rpx;
  padding: 0 24rpx;
  font-size: 30rpx;
  color: #333;

  &:focus {
    border-color: #4caf50;
  }
}

.ph {
  color: #ccc;
}

.tips-card {
  padding: 24rpx;
  background-color: #fff8e1;
  border-radius: 12rpx;
  margin-bottom: 32rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.tips-title {
  font-size: 26rpx;
  color: #795548;
  font-weight: 600;
}

.tips-item {
  font-size: 24rpx;
  color: #795548;
}

.submit-btn {
  width: 100%;
  height: 96rpx;
  background-color: #4caf50;
  border-radius: 12rpx;
  border: none;
  color: #fff;
  font-size: 32rpx;
  font-weight: 500;

  &::after {
    border: none;
  }

  &[disabled] {
    background-color: #c8e6c9;
  }
}
</style>
