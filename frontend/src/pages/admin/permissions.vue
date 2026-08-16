<template>
  <view class="page">
    <view class="top-bar">
      <text class="page-title">工作人员权限</text>
    </view>

    <view class="intro">
      <text class="intro-text">老板账号默认拥有全部权限。可在此将工作人员升为 STAFF，并为其分配/收回以下三项功能权限。</text>
    </view>

    <view class="perm-legend">
      <view v-for="p in availablePerms" :key="p.permission" class="legend-item">
        <text class="legend-code">{{ p.permission }}</text>
        <text class="legend-label">{{ p.label }}</text>
      </view>
    </view>

    <!-- 提升为工作人员 -->
    <view class="promote-card">
      <text class="card-label">将普通用户提升为工作人员</text>
      <view class="promote-row">
        <input
          v-model="promoteUserId"
          class="promote-input"
          placeholder="输入用户 ID"
          type="number"
        />
        <view class="promote-btn" :class="{ disabled: promoting }" @click="onPromote">
          <text class="promote-btn-text">{{ promoting ? '处理中...' : '设为工作人员' }}</text>
        </view>
      </view>
    </view>

    <view v-if="staffList.length" class="staff-list">
      <view v-for="staff in staffList" :key="staff.userId" class="staff-card">
        <view class="staff-head">
          <image
            v-if="staff.avatar"
            class="staff-avatar"
            :src="staff.avatar"
            mode="aspectFill"
          />
          <view v-else class="staff-avatar avatar-ph">
            <text class="avatar-ph-text">{{ initialOf(staff.nickname) }}</text>
          </view>
          <view class="staff-info">
            <text class="staff-name">{{ staff.nickname || '未命名' }}</text>
            <text class="staff-role">角色：{{ roleLabel(staff.role) }}</text>
          </view>
          <text class="staff-id">ID: {{ staff.userId }}</text>
        </view>

        <view class="perm-grid">
          <view
            v-for="p in availablePerms"
            :key="p.permission"
            class="perm-item"
            :class="{ granted: hasPerm(staff, p.permission) }"
          >
            <view class="perm-info">
              <text class="perm-label">{{ p.label }}</text>
              <text class="perm-code">{{ p.permission }}</text>
            </view>
            <view
              class="perm-toggle"
              :class="{ on: hasPerm(staff, p.permission), disabled: togglingKey === staff.userId + p.permission }"
              @click="onToggle(staff, p.permission)"
            >
              <text class="toggle-text">
                {{
                  togglingKey === staff.userId + p.permission
                    ? '...'
                    : hasPerm(staff, p.permission)
                      ? '收回'
                      : '授予'
                }}
              </text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view v-else-if="!loading" class="empty">
      <text class="empty-text">暂无工作人员</text>
      <text class="empty-sub">可在上方将普通用户提升为工作人员</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { permissionApi } from '@/api/admin';
import type { AvailablePermission, StaffPermissionCode, StaffWithPermissions } from '@/types';

const staffList = ref<StaffWithPermissions[]>([]);
const availablePerms = ref<AvailablePermission[]>([]);
const loading = ref(false);
const promoteUserId = ref('');
const promoting = ref(false);
const togglingKey = ref('');

async function loadData(): Promise<void> {
  loading.value = true;
  try {
    const [staff, perms] = await Promise.all([
      permissionApi.listStaff(),
      permissionApi.getAvailable(),
    ]);
    staffList.value = staff;
    availablePerms.value = perms;
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '加载失败', icon: 'none' });
  } finally {
    loading.value = false;
  }
}

function hasPerm(staff: StaffWithPermissions, code: StaffPermissionCode): boolean {
  return staff.permissions.some((p) => p.permission === code);
}

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    BOSS: '老板',
    SUPER_ADMIN: '超级管理员',
    ADMIN: '管理员',
    STAFF: '工作人员',
    USER: '普通用户',
    HELPER: '帮助者',
  };
  return map[role] ?? role;
}

function initialOf(name: string): string {
  return (name || '?').charAt(0).toUpperCase();
}

async function onPromote(): Promise<void> {
  if (!promoteUserId.value.trim()) {
    uni.showToast({ title: '请输入用户 ID', icon: 'none' });
    return;
  }
  promoting.value = true;
  try {
    await permissionApi.setStaff(promoteUserId.value.trim());
    uni.showToast({ title: '已设为工作人员', icon: 'success' });
    promoteUserId.value = '';
    await loadData();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '操作失败', icon: 'none' });
  } finally {
    promoting.value = false;
  }
}

async function onToggle(staff: StaffWithPermissions, code: StaffPermissionCode): Promise<void> {
  const granted = hasPerm(staff, code);
  const key = staff.userId + code;
  togglingKey.value = key;
  try {
    if (granted) {
      await permissionApi.revoke(staff.userId, code);
      uni.showToast({ title: '已收回权限', icon: 'success' });
    } else {
      await permissionApi.grant(staff.userId, code);
      uni.showToast({ title: '已授予权限', icon: 'success' });
    }
    await loadData();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '操作失败', icon: 'none' });
  } finally {
    if (togglingKey.value === key) togglingKey.value = '';
  }
}

onShow(() => {
  loadData();
});
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  padding: 24rpx;
  background-color: #f5f5f5;
  box-sizing: border-box;
}

.top-bar {
  margin-bottom: 16rpx;
}

.page-title {
  font-size: 36rpx;
  font-weight: 700;
  color: #333;
}

.intro {
  padding: 20rpx 24rpx;
  background-color: #fff8e1;
  border-radius: 16rpx;
  margin-bottom: 20rpx;
}

.intro-text {
  font-size: 26rpx;
  color: #795548;
  line-height: 1.5;
}

.perm-legend {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 20rpx 24rpx;
  background-color: #fff;
  border-radius: 16rpx;
  margin-bottom: 24rpx;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.legend-code {
  font-size: 22rpx;
  color: #4caf50;
  font-family: monospace;
}

.legend-label {
  font-size: 26rpx;
  color: #555;
}

.promote-card {
  padding: 24rpx;
  background-color: #fff;
  border-radius: 16rpx;
  margin-bottom: 24rpx;
}

.card-label {
  display: block;
  font-size: 28rpx;
  color: #333;
  font-weight: 600;
  margin-bottom: 16rpx;
}

.promote-row {
  display: flex;
  gap: 16rpx;
}

.promote-input {
  flex: 1;
  height: 72rpx;
  padding: 0 20rpx;
  border: 2rpx solid #e0e0e0;
  border-radius: 12rpx;
  font-size: 26rpx;
  box-sizing: border-box;
}

.promote-btn {
  padding: 0 28rpx;
  height: 72rpx;
  background-color: #2196f3;
  border-radius: 12rpx;
  display: flex;
  align-items: center;

  &.disabled {
    background-color: #bbdefb;
  }
}

.promote-btn-text {
  color: #fff;
  font-size: 26rpx;
}

.staff-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.staff-card {
  padding: 24rpx;
  background-color: #fff;
  border-radius: 20rpx;
}

.staff-head {
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
}

.staff-avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background-color: #e0e0e0;

  &.avatar-ph {
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

.avatar-ph-text {
  font-size: 32rpx;
  color: #fff;
  font-weight: 600;
}

.staff-info {
  flex: 1;
  margin-left: 20rpx;
}

.staff-name {
  display: block;
  font-size: 30rpx;
  color: #333;
  font-weight: 600;
}

.staff-role {
  font-size: 24rpx;
  color: #999;
  margin-top: 4rpx;
}

.staff-id {
  font-size: 22rpx;
  color: #bbb;
}

.perm-grid {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  border-top: 1rpx solid #f0f0f0;
  padding-top: 16rpx;
}

.perm-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16rpx;
  background-color: #f9f9f9;
  border-radius: 12rpx;

  &.granted {
    background-color: #e8f5e9;
  }
}

.perm-info {
  display: flex;
  flex-direction: column;
}

.perm-label {
  font-size: 28rpx;
  color: #333;
}

.perm-code {
  font-size: 22rpx;
  color: #999;
  font-family: monospace;
  margin-top: 4rpx;
}

.perm-toggle {
  padding: 12rpx 28rpx;
  border-radius: 24rpx;
  background-color: #4caf50;

  &.on {
    background-color: #ff9800;
  }

  &.disabled {
    opacity: 0.5;
  }
}

.toggle-text {
  color: #fff;
  font-size: 26rpx;
}

.empty {
  padding: 120rpx 0;
  text-align: center;
}

.empty-text {
  display: block;
  font-size: 28rpx;
  color: #999;
}

.empty-sub {
  font-size: 24rpx;
  color: #bbb;
  margin-top: 8rpx;
}
</style>
