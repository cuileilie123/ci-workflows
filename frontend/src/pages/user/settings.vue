<template>
  <view class="settings-page">
    <!-- 账号 -->
    <view class="cell-group">
      <view class="group-title">账号</view>
      <view class="cell-item" @click="changePhone">
        <text class="cell-label">手机号</text>
        <text class="cell-value">{{ maskedPhone }}</text>
      </view>
      <view class="cell-item" @click="changePassword">
        <text class="cell-label">修改密码</text>
        <text class="cell-arrow">›</text>
      </view>
      <view class="cell-item danger" @click="deleteAccount">
        <text class="cell-label danger-text">注销账号</text>
        <text class="cell-arrow">›</text>
      </view>
    </view>

    <!-- 通知 -->
    <view class="cell-group">
      <view class="group-title">通知</view>
      <view class="cell-item">
        <text class="cell-label">订单状态推送</text>
        <switch :checked="notifyOrder" color="#4caf50" @change="onNotifyOrderChange" />
      </view>
      <view class="cell-item">
        <text class="cell-label">优惠活动通知</text>
        <switch :checked="notifyPromo" color="#4caf50" @change="onNotifyPromoChange" />
      </view>
      <view class="cell-item">
        <text class="cell-label">夜间免打扰</text>
        <switch :checked="dndMode" color="#4caf50" @change="onDndModeChange" />
      </view>
    </view>

    <!-- 隐私 -->
    <view class="cell-group">
      <view class="group-title">隐私</view>
      <view class="cell-item">
        <text class="cell-label">隐藏手机号</text>
        <switch :checked="hidePhone" color="#4caf50" @change="onHidePhoneChange" />
      </view>
      <view class="cell-item">
        <text class="cell-label">关闭位置历史</text>
        <switch :checked="clearLocation" color="#4caf50" @change="onClearLocationChange" />
      </view>
    </view>

    <!-- 通用 -->
    <view class="cell-group">
      <view class="group-title">通用</view>
      <view class="cell-item" @click="clearCache">
        <text class="cell-label">清除缓存</text>
        <text class="cell-value">{{ cacheSize }}</text>
      </view>
      <view class="cell-item" @click="feedback">
        <text class="cell-label">意见反馈</text>
        <text class="cell-arrow">›</text>
      </view>
      <view class="cell-item">
        <text class="cell-label">版本</text>
        <text class="cell-value">{{ version }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { userApi, type UserProfile } from '@/api/user';
import { useUserStore } from '@/store/user';
import { tracker, EVENTS } from '@/utils/track';

/** 从 switch change 事件中安全提取选中状态 */
function getSwitchValue(e: Event): boolean {
  return (e as unknown as { detail: { value: boolean } }).detail.value;
}

/** 从用户资料生成脱敏手机号（后端未返回时兜底） */
function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '未绑定';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return phone;
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

// 设置项
const notifyOrder = ref(true);
const notifyPromo = ref(true);
const dndMode = ref(false);
const hidePhone = ref(false);
const clearLocation = ref(false);
const cacheSize = ref('12.5MB');
const profile = ref<UserProfile | null>(null);
const submitting = ref('');
const version = 'v1.0.0';

const maskedPhone = computed(() => maskPhone(profile.value?.phone));

function onNotifyOrderChange(e: Event): void {
  notifyOrder.value = getSwitchValue(e);
  saveSettings();
}

function onNotifyPromoChange(e: Event): void {
  notifyPromo.value = getSwitchValue(e);
  saveSettings();
}

function onDndModeChange(e: Event): void {
  dndMode.value = getSwitchValue(e);
  saveSettings();
}

function onHidePhoneChange(e: Event): void {
  hidePhone.value = getSwitchValue(e);
  saveSettings();
}

function onClearLocationChange(e: Event): void {
  clearLocation.value = getSwitchValue(e);
  saveSettings();
}

function saveSettings(): void {
  uni.setStorageSync('settings', {
    notifyOrder: notifyOrder.value,
    notifyPromo: notifyPromo.value,
    dndMode: dndMode.value,
    hidePhone: hidePhone.value,
    clearLocation: clearLocation.value,
  });
}

async function changePhone(): Promise<void> {
  // 让用户输入新手机号（实际项目中应配合短信验证码）
  const res = await new Promise<UniApp.ShowModalRes>((resolve) => {
    uni.showModal({
      title: '修改手机号',
      editable: true,
      placeholderText: '请输入新手机号',
      confirmText: '提交',
      success: resolve,
      fail: () => resolve({ confirm: false, cancel: true }),
    });
  });
  if (!res.confirm || !res.content) return;
  const phone = res.content.trim();
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    uni.showToast({ title: '手机号格式错误', icon: 'none' });
    return;
  }
  submitting.value = 'phone';
  try {
    await userApi.changePhone(phone);
    // 同步刷新本地 userStore
    const userStore = useUserStore();
    if (userStore.userInfo) userStore.userInfo.phone = phone;
    // 刷新页面资料缓存
    profile.value = null;
    await loadProfile();
    uni.showToast({ title: '手机号已更新', icon: 'success' });
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '更新失败', icon: 'none' });
  } finally {
    submitting.value = '';
  }
}

async function changePassword(): Promise<void> {
  // 简单起见使用两次弹窗收集旧密码和新密码（实际项目应使用专用输入页）
  const oldRes = await new Promise<UniApp.ShowModalRes>((resolve) => {
    uni.showModal({
      title: '修改密码',
      editable: true,
      placeholderText: '请输入旧密码',
      success: resolve,
      fail: () => resolve({ confirm: false, cancel: true }),
    });
  });
  if (!oldRes.confirm || !oldRes.content) return;
  const oldPwd = oldRes.content;

  const newRes = await new Promise<UniApp.ShowModalRes>((resolve) => {
    uni.showModal({
      title: '新密码',
      editable: true,
      placeholderText: '请输入新密码（至少 6 位）',
      success: resolve,
      fail: () => resolve({ confirm: false, cancel: true }),
    });
  });
  if (!newRes.confirm || !newRes.content) return;
  const newPwd = newRes.content;
  if (newPwd.length < 6) {
    uni.showToast({ title: '密码长度不少于 6 位', icon: 'none' });
    return;
  }
  submitting.value = 'password';
  try {
    await userApi.changePassword(oldPwd, newPwd);
    uni.showToast({ title: '密码已更新', icon: 'success' });
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '更新失败', icon: 'none' });
  } finally {
    submitting.value = '';
  }
}

function deleteAccount(): void {
  uni.showModal({
    title: '警告',
    content: '注销账号后，所有数据将无法恢复，确定要继续吗？',
    confirmColor: '#f44336',
    success: async (res) => {
      if (!res.confirm) return;
      const reasonRes = await new Promise<UniApp.ShowModalRes>((resolve) => {
        uni.showModal({
          title: '注销原因',
          editable: true,
          placeholderText: '选填：告诉我们注销的原因',
          confirmText: '确认注销',
          success: resolve,
          fail: () => resolve({ confirm: false, cancel: true }),
        });
      });
      if (!reasonRes.confirm) return;
      submitting.value = 'delete';
      try {
        await userApi.deleteAccount(reasonRes.content || undefined);
        uni.showToast({ title: '账号已注销', icon: 'success' });
        const userStore = useUserStore();
        userStore.clearLocal();
        setTimeout(() => {
          uni.reLaunch({ url: '/pages/auth/login' });
        }, 1500);
      } catch (e) {
        uni.showToast({ title: (e as Error).message || '注销失败', icon: 'none' });
      } finally {
        submitting.value = '';
      }
    },
  });
}

function clearCache(): void {
  uni.showModal({
    title: '清除缓存',
    content: '确定要清除缓存吗？（不会清除登录状态）',
    success: (res) => {
      if (res.confirm) {
        // 只清除缓存数据，保留 token 和设置
        const token = uni.getStorageSync('nh_access_token');
        const refreshToken = uni.getStorageSync('nh_refresh_token');
        const settings = uni.getStorageSync('settings');
        
        // 清除其他缓存
        const keys = uni.getStorageInfoSync().keys;
        keys.forEach(key => {
          if (!['nh_access_token', 'nh_refresh_token', 'settings'].includes(key)) {
            uni.removeStorageSync(key);
          }
        });
        
        // 恢复重要数据
        if (token) uni.setStorageSync('nh_access_token', token);
        if (refreshToken) uni.setStorageSync('nh_refresh_token', refreshToken);
        if (settings) uni.setStorageSync('settings', settings);
        
        cacheSize.value = '0MB';
        uni.showToast({ title: '清除成功', icon: 'success' });
      }
    },
  });
}

async function feedback(): Promise<void> {
  const res = await new Promise<UniApp.ShowModalRes>((resolve) => {
    uni.showModal({
      title: '意见反馈',
      editable: true,
      placeholderText: '请输入您的建议或问题，我们会尽快处理',
      confirmText: '提交',
      success: resolve,
      fail: () => resolve({ confirm: false, cancel: true }),
    });
  });
  if (!res.confirm || !res.content) return;
  const content = res.content.trim();
  if (content.length < 5) {
    uni.showToast({ title: '请至少输入 5 个字', icon: 'none' });
    return;
  }
  submitting.value = 'feedback';
  try {
    const r = await userApi.submitFeedback(content);
    const ticketMsg = r.ticketId ? `，工单号：${r.ticketId}` : '';
    uni.showToast({ title: `提交成功${ticketMsg}`, icon: 'success' });
    tracker.track(EVENTS.FEEDBACK_SUBMIT, { length: content.length });
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '提交失败', icon: 'none' });
  } finally {
    submitting.value = '';
  }
}

/** 加载后端用户资料 */
async function loadProfile(): Promise<void> {
  try {
    // 1) 优先从后端接口拉取
    const data = await userApi.getProfile();
    profile.value = data;
    // 同步刷新 userStore 缓存
    const userStore = useUserStore();
    if (data && userStore.userInfo) {
      userStore.userInfo.nickname = data.nickname || userStore.userInfo.nickname;
      userStore.userInfo.avatar = data.avatar || userStore.userInfo.avatar;
      userStore.userInfo.phone = data.phone || null;
    }
  } catch {
    // 2) 后端不可用时，从本地 store 兜底
    const userStore = useUserStore();
    if (userStore.userInfo) {
      profile.value = {
        id: String(userStore.userInfo.id),
        nickname: userStore.userInfo.nickname || '',
        avatar: userStore.userInfo.avatar || null,
        phone: (userStore.userInfo as any).phone || null,
        gender: 'UNKNOWN',
        bio: null,
        createdAt: '',
      };
    }
  }
}

/** 加载后端设置（与本地缓存合并） */
async function loadSettings(): Promise<void> {
  try {
    const srv = await userApi.getSettings();
    notifyOrder.value = !!srv.notifyEnabled;
    dndMode.value = false;
    // 本地缓存的其他项（后端未返回的保持默认/本地）
    const saved = uni.getStorageSync('settings');
    if (saved) {
      notifyPromo.value = saved.notifyPromo ?? true;
      hidePhone.value = saved.hidePhone ?? false;
      clearLocation.value = saved.clearLocation ?? false;
    }
  } catch {
    const saved = uni.getStorageSync('settings');
    if (saved) {
      notifyOrder.value = saved.notifyOrder ?? true;
      notifyPromo.value = saved.notifyPromo ?? true;
      dndMode.value = saved.dndMode ?? false;
      hidePhone.value = saved.hidePhone ?? false;
      clearLocation.value = saved.clearLocation ?? false;
    }
  }
}

onShow(() => {
  tracker.track(EVENTS.PAGE_VIEW, { page: 'user_settings' });
  loadProfile();
  loadSettings();
});

onMounted(() => {
  // 预估缓存大小（小程序无直接 API，使用存储 key 估算）
  try {
    const info = uni.getStorageInfoSync();
    const sizeKB = info.currentSize || 0;
    if (sizeKB >= 1024) {
      cacheSize.value = `${(sizeKB / 1024).toFixed(1)}MB`;
    } else {
      cacheSize.value = `${sizeKB}KB`;
    }
  } catch {
    // 忽略
  }
});
</script>

<style lang="scss" scoped>
.settings-page {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding: 24rpx;
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
}

.cell-group {
  margin-bottom: 24rpx;
  background-color: #fff;
  border-radius: 20rpx;
  overflow: hidden;
}

.group-title {
  padding: 20rpx 28rpx 8rpx;
  font-size: 24rpx;
  color: #999;
}

.cell-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx;
  border-bottom: 1rpx solid #f5f5f5;

  &:last-child {
    border-bottom: none;
  }

  &.danger {
    .cell-label {
      color: #f44336;
    }
  }
}

.cell-label {
  font-size: 30rpx;
  color: #333;

  &.danger-text {
    color: #f44336;
  }
}

.cell-value {
  font-size: 28rpx;
  color: #999;
}

.cell-arrow {
  font-size: 36rpx;
  color: #ccc;
}
</style>
