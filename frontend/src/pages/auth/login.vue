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

      <!-- #ifdef H5 -->
      <view class="debug-section">
        <text class="debug-label">🛠 H5 调试模式</text>
        <view class="row">
          <input
            class="nickname-input"
            placeholder="粘贴微信开发者工具获取的 code"
            placeholder-class="nickname-ph"
            :value="h5Code"
            @input="onH5CodeInput"
          />
        </view>
        <text class="debug-hint">
          在微信开发者工具 Console 执行：wx.login({ success: res => console.log(res.code) })
        </text>
      </view>
      <!-- #endif -->

      <button class="login-btn" :disabled="loading" @click="onLogin">
        {{ loading ? '登录中...' : '微信一键登录' }}
      </button>

      <!-- #ifdef H5 || MP-WEIXIN -->
      <view class="dev-section">
        <text class="dev-label">开发调试</text>
        <view class="dev-btns">
          <button class="dev-btn mock-btn" :disabled="loading" @click="onMockLogin()">
            普通用户
          </button>
          <button class="dev-btn boss-btn" :disabled="loading" @click="onMockLogin('1')">
            老板账号
          </button>
          <button class="dev-btn admin-btn" :disabled="loading" @click="onMockLogin('2')">
            管理员
          </button>
        </view>
      </view>
      <!-- #endif -->

      <text class="tip">登录即代表同意《用户协议》与《隐私政策》</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useUserStore } from '@/store/user';
import type { User } from '@/types';

const userStore = useUserStore();
const avatarUrl = ref('');
const nickname = ref('');
const loading = ref(false);
const h5Code = ref('');

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

// #ifdef H5
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onH5CodeInput(e: any): void {
  // H5 native InputEvent has target.value; MP-WEIXIN has detail.value
  const value = e?.detail?.value ?? e?.target?.value ?? '';
  h5Code.value = value.trim();
}
// #endif

async function onLogin(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  try {
    // #ifdef H5
    // H5 mode: use pasted code directly
    if (h5Code.value) {
      await userStore.login(h5Code.value, {
        nickname: nickname.value,
        avatarUrl: avatarUrl.value,
      });
      uni.showToast({ title: '登录成功', icon: 'success' });
      uni.reLaunch({ url: '/pages/index/index' });
      return;
    }
    // #endif

    // 获取微信登录code
    let code: string;
    try {
      const loginRes = await new Promise<UniApp.LoginRes>((resolve, reject) => {
        uni.login({
          provider: 'weixin',
          success: resolve,
          fail: (err) => {
            console.error('uni.login 失败:', err);
            reject(err);
          },
        });
      });
      code = loginRes.code;
      console.log('获取到微信登录code:', code ? `${code.slice(0, 10)}...` : 'null');
    } catch (loginErr) {
      console.error('获取微信code失败:', loginErr);
      uni.showToast({
        title: '获取登录凭证失败，请重试',
        icon: 'none',
        duration: 2000,
      });
      return;
    }

    if (!code) {
      uni.showToast({
        title: '获取登录凭证失败',
        icon: 'none',
        duration: 2000,
      });
      return;
    }

    // 调用登录接口
    await userStore.login(code, {
      nickname: nickname.value,
      avatarUrl: avatarUrl.value,
    });

    uni.showToast({ title: '登录成功', icon: 'success' });
    uni.reLaunch({ url: '/pages/index/index' });
  } catch (err) {
    const errorMsg = (err as Error)?.message || '登录失败';
    console.error('登录失败:', err);
    // request 拦截器已 Toast 错误信息，此处仅记录日志
    uni.showToast({
      title: errorMsg.includes('网络') ? '网络错误，请检查后端服务' : errorMsg,
      icon: 'none',
      duration: 3000,
    });
  } finally {
    loading.value = false;
  }
}

// #ifdef H5 || MP-WEIXIN
async function onMockLogin(userId?: string): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  try {
    const requestData: Record<string, string> = {};
    if (userId) {
      requestData.userId = userId;
    } else {
      requestData.nickname = nickname.value || 'Mock用户';
    }

    const res = await new Promise<{ data: { code: number; data: { accessToken: string; refreshToken: string; user: { id: string; nickname: string; avatar?: string | null; role?: string } }; message?: string } }>((resolve, reject) => {
      uni.request({
        url: `${import.meta.env.VITE_API_BASE_URL}/auth/test-login`,
        method: 'POST',
        data: requestData,
        header: { 'Content-Type': 'application/json' },
        success: (r) => resolve(r as unknown as { data: { code: number; data: { accessToken: string; refreshToken: string; user: { id: string; nickname: string; avatar?: string | null; role?: string } }; message?: string } }),
        fail: reject,
      });
    });
    const body = res.data;
    if (body.code === 0 && body.data?.accessToken && body.data?.refreshToken) {
      const mockUser: User = {
        id: body.data.user.id,
        openid: '',
        nickname: body.data.user.nickname,
        avatar: body.data.user.avatar ?? null,
        phone: null,
        creditScore: 100,
        role: body.data.user.role || 'USER',
        status: 'ACTIVE',
      };
      userStore.setMockLoginState(
        body.data.accessToken,
        body.data.refreshToken,
        mockUser,
      );
      const roleLabel = mockUser.role === 'BOSS' ? '老板' : mockUser.role === 'ADMIN' ? '管理员' : mockUser.role === 'STAFF' ? '员工' : '普通用户';
      uni.showToast({ title: `${roleLabel}登录成功`, icon: 'success' });
      uni.reLaunch({ url: '/pages/index/index' });
    } else {
      uni.showToast({ title: body.message || '登录失败', icon: 'none' });
    }
  } catch (e) {
    console.error('Mock 登录失败:', e);
    uni.showToast({ title: '网络错误，请确认后端已启动', icon: 'none', duration: 3000 });
  } finally {
    loading.value = false;
  }
}
// #endif
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

.debug-section {
  margin-bottom: 32rpx;
  padding: 24rpx;
  background-color: #f1f8e9;
  border-radius: 12rpx;
  border-left: 4rpx solid #8bc34a;
}

.debug-label {
  font-size: 26rpx;
  font-weight: 600;
  color: #558b2f;
  margin-bottom: 12rpx;
  display: block;
}

.debug-hint {
  font-size: 22rpx;
  color: #7cb342;
  line-height: 1.5;
  display: block;
}

.mock-btn {
  background-color: #ff9800;
  margin-top: 16rpx;

  &[disabled] {
    background-color: #ffcc80;
  }
}

.dev-section {
  margin-top: 32rpx;
  padding: 24rpx;
  background-color: #fff8e1;
  border-radius: 16rpx;
  border: 2rpx dashed #ffb74d;
}

.dev-label {
  font-size: 24rpx;
  color: #f57c00;
  font-weight: 600;
  display: block;
  margin-bottom: 16rpx;
  text-align: center;
}

.dev-btns {
  display: flex;
  gap: 16rpx;
}

.dev-btn {
  flex: 1;
  height: 72rpx;
  line-height: 72rpx;
  font-size: 26rpx;
  border-radius: 12rpx;
  margin: 0;
  padding: 0;

  &::after {
    border: none;
  }
}

.dev-btn.mock-btn {
  background-color: #e0e0e0;
  color: #424242;

  &[disabled] {
    background-color: #eeeeee;
    color: #9e9e9e;
  }
}

.dev-btn.boss-btn {
  background-color: #ff6f00;
  color: #fff;

  &[disabled] {
    background-color: #ffab40;
  }
}

.dev-btn.admin-btn {
  background-color: #1565c0;
  color: #fff;

  &[disabled] {
    background-color: #64b5f6;
  }
}
</style>
