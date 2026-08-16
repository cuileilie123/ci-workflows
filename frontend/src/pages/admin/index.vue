<template>
  <scroll-view class="admin-page" scroll-y>
    <view class="header">
      <text class="title">中端管理</text>
      <text class="subtitle">{{ roleLabel }}</text>
    </view>

    <view class="entry-list">
      <view v-if="perm.isBoss" class="entry-card boss" @click="go('/pages/admin/finance-settings')">
        <text class="entry-icon">🏦</text>
        <view class="entry-info">
          <text class="entry-title">财务设置</text>
          <text class="entry-desc">配置平台佣金收款账号（分账接收方）</text>
        </view>
        <text class="arrow">›</text>
      </view>

      <view
        v-if="perm.canManageProfitSharing"
        class="entry-card"
        @click="go('/pages/admin/profit-sharing')"
      >
        <text class="entry-icon">💰</text>
        <view class="entry-info">
          <text class="entry-title">分佣比例管理</text>
          <text class="entry-desc">设计/修改分账规则与平台抽成</text>
        </view>
        <text class="arrow">›</text>
      </view>

      <view
        v-if="perm.canManageOrderPrice"
        class="entry-card"
        @click="go('/pages/admin/order-price')"
      >
        <text class="entry-icon">📝</text>
        <view class="entry-info">
          <text class="entry-title">订单改价</text>
          <text class="entry-desc">修改未完成订单价格，打回发布者确认</text>
        </view>
        <text class="arrow">›</text>
      </view>

      <view
        v-if="perm.canManageTaskCategory"
        class="entry-card"
        @click="go('/pages/admin/task-category')"
      >
        <text class="entry-icon">🏷️</text>
        <view class="entry-info">
          <text class="entry-title">任务分类管理</text>
          <text class="entry-desc">修改/删减任务分类标签</text>
        </view>
        <text class="arrow">›</text>
      </view>

      <view v-if="perm.isBoss" class="entry-card boss" @click="go('/pages/admin/permissions')">
        <text class="entry-icon">🔑</text>
        <view class="entry-info">
          <text class="entry-title">工作人员权限</text>
          <text class="entry-desc">为工作人员开通/收回功能权限</text>
        </view>
        <text class="arrow">›</text>
      </view>
    </view>

    <view v-if="!perm.hasAnyAdminEntry" class="empty">
      <text class="empty-text">暂无可用的管理功能</text>
      <text class="empty-sub">请联系老板开通相关权限</text>
    </view>

    <view class="note">
      <text class="note-text">微信支付渠道费率 0.6% 已写入底层代码，所有人仅可阅读。</text>
    </view>
  </scroll-view>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { usePermissionStore } from '@/store/permission';

const perm = usePermissionStore();

const roleLabel = computed(() => {
  const map: Record<string, string> = {
    BOSS: '老板账号',
    SUPER_ADMIN: '超级管理员',
    ADMIN: '管理员',
    STAFF: '工作人员',
  };
  return map[perm.role] || perm.role;
});

function go(url: string): void {
  uni.navigateTo({ url });
}

onShow(async () => {
  await perm.load();
});
</script>

<style lang="scss" scoped>
.admin-page {
  min-height: 100vh;
  padding: 24rpx;
  background-color: #f5f5f5;
  box-sizing: border-box;
}

.header {
  padding: 32rpx 24rpx;
  background: linear-gradient(135deg, #4caf50, #2e7d32);
  border-radius: 20rpx;
  color: #fff;
  margin-bottom: 24rpx;
}

.title {
  font-size: 40rpx;
  font-weight: 700;
  display: block;
}

.subtitle {
  font-size: 26rpx;
  opacity: 0.9;
  margin-top: 8rpx;
  display: block;
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.entry-card {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 32rpx 28rpx;
  background-color: #fff;
  border-radius: 20rpx;

  &.boss {
    border: 2rpx solid #ffb300;
  }
}

.entry-icon {
  font-size: 48rpx;
}

.entry-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.entry-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #333;
}

.entry-desc {
  font-size: 24rpx;
  color: #888;
}

.arrow {
  font-size: 40rpx;
  color: #ccc;
}

.empty {
  padding: 120rpx 0;
  text-align: center;
}

.empty-text {
  font-size: 30rpx;
  color: #999;
  display: block;
}

.empty-sub {
  font-size: 24rpx;
  color: #bbb;
  margin-top: 12rpx;
  display: block;
}

.note {
  margin-top: 32rpx;
  padding: 24rpx;
  background-color: #fff8e1;
  border-radius: 16rpx;
}

.note-text {
  font-size: 24rpx;
  color: #8d6e63;
}
</style>
