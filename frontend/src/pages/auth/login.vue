<template>
  <view class="login-page">
    <view class="logo-area">
      <image class="logo" src="/static/logo.png" mode="aspectFit" />
      <text class="app-name">邻里互助</text>
      <text class="app-desc">社区有偿互助平台</text>
    </view>

    <view class="form">
      <view class="row">
        <button class="avatar-btn" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
          <image v-if="avatarUrl" class="avatar" :src="avatarUrl" mode="aspectFill" />
          <view v-else class="avatar-placeholder">
            <text class="avatar-placeholder-text">点击选择头像</text>
          </view>
        </button>
      </view>

      <view class="row">
        <input
          class="nickname-input"
          type="nickname"
          placeholder="请输入昵称"
          placeholder-class="nickname-ph"
          :value="nickname"
          @blur="onNicknameBlur"
        />
      </view>

      <button class="login-btn" :disabled="loading" @click="onLogin">
        {{ loading ? '登录中...' : '微信一键登录' }}
      </button>

      <text class="tip">登录即代表同意《用户协议》与《隐私政策》</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useUserStore } from '@/store/user';

const userStore = useUserStore();
const avatarUrl = ref('');
const nickname = ref('');
const loading = ref(false);

interface ChooseAvatarEvent {
  detail: { avatarUrl: string };
}

function onChooseAvatar(e: ChooseAvatarEvent): void {
  avatarUrl.value = e.detail.avatarUrl;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onNicknameBlur(e: any): void {
  const value: string = e?.detail?.value ?? '';
  nickname.value = value.trim();
}

async function onLogin(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  try {
    const { code } = await new Promise<UniApp.LoginRes>((resolve, reject) => {
      uni.login({ provider: 'weixin', success: resolve, fail: reject });
    });
    if (!code) {
      uni.showToast({ title: '获取登录凭证失败', icon: 'none' });
      return;
    }
    await userStore.login(code, {
      nickname: nickname.value,
      avatarUrl: avatarUrl.value,
    });
    uni.showToast({ title: '登录成功', icon: 'success' });
    uni.reLaunch({ url: '/pages/index/index' });
  } catch {
    // request 拦截器已 Toast 错误信息，此处仅恢复按钮状态
  } finally {
    loading.value = false;
  }
}
</script>

<style lang="scss" scoped>
.login-page {
  min-height: 100vh;
  padding: 0 48rpx;
  background: linear-gradient(180deg, #e8f5e9 0%, #f8f8f8 40%);
  display: flex;
  flex-direction: column;
}

.logo-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 140rpx;
  padding-bottom: 80rpx;
}

.logo {
  width: 160rpx;
  height: 160rpx;
  border-radius: 32rpx;
}

.app-name {
  font-size: 44rpx;
  font-weight: bold;
  color: #2e7d32;
  margin-top: 24rpx;
}

.app-desc {
  font-size: 26rpx;
  color: #666;
  margin-top: 12rpx;
}

.form {
  background-color: #fff;
  border-radius: 24rpx;
  padding: 48rpx 32rpx;
  box-shadow: 0 4rpx 24rpx rgba(0, 0, 0, 0.06);
}

.row {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 32rpx;
}

.avatar-btn {
  width: 140rpx;
  height: 140rpx;
  padding: 0;
  margin: 0;
  border-radius: 50%;
  background-color: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;

  &::after {
    border: none;
  }
}

.avatar {
  width: 140rpx;
  height: 140rpx;
  border-radius: 50%;
}

.avatar-placeholder {
  width: 140rpx;
  height: 140rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.avatar-placeholder-text {
  font-size: 22rpx;
  color: #999;
  text-align: center;
}

.nickname-input {
  width: 100%;
  height: 88rpx;
  padding: 0 24rpx;
  font-size: 30rpx;
  background-color: #f7f7f7;
  border-radius: 12rpx;
  box-sizing: border-box;
}

.nickname-ph {
  color: #bbb;
}

.login-btn {
  width: 100%;
  height: 92rpx;
  line-height: 92rpx;
  margin-top: 16rpx;
  background-color: #4caf50;
  color: #fff;
  font-size: 32rpx;
  border-radius: 46rpx;

  &::after {
    border: none;
  }

  &[disabled] {
    background-color: #a5d6a7;
    color: #fff;
  }
}

.tip {
  display: block;
  text-align: center;
  font-size: 22rpx;
  color: #999;
  margin-top: 24rpx;
}
</style>
