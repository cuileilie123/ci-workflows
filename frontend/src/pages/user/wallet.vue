<template>
  <view class="wallet-page">
    <!-- 余额卡片 -->
    <view class="balance-card">
      <view class="balance-header">
        <text class="balance-title">我的钱包</text>
        <view class="withdraw-btn" @click="openWithdrawModal">
          <text class="withdraw-text">提现</text>
        </view>
      </view>
      <view class="balance-main">
        <view class="balance-item">
          <text class="balance-label">可用余额（元）</text>
          <text class="balance-value">{{ balance.available.toFixed(2) }}</text>
        </view>
        <view class="balance-divider"></view>
        <view class="balance-item">
          <text class="balance-label">冻结金额（元）</text>
          <text class="balance-value frozen">{{ balance.frozen.toFixed(2) }}</text>
        </view>
      </view>
    </view>

    <!-- Tab 切换 -->
    <view class="tabs">
      <view
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-item"
        :class="{ active: activeTab === tab.key }"
        @click="switchTab(tab.key)"
      >
        <text class="tab-label">{{ tab.label }}</text>
      </view>
    </view>

    <!-- 流水列表 -->
    <view class="transaction-list" v-if="filteredTransactions.length > 0">
      <view
        v-for="tx in filteredTransactions"
        :key="tx.id"
        class="transaction-item"
      >
        <view class="tx-icon" :class="getIconClass(tx.type)">
          <text class="icon-text">{{ getIcon(tx.type) }}</text>
        </view>
        <view class="tx-info">
          <text class="tx-desc">{{ tx.description }}</text>
          <text class="tx-time">{{ formatTime(tx.createdAt) }}</text>
        </view>
        <view class="tx-amount" :class="getAmountClass(tx.type)">
          <text>{{ getAmountDisplay(tx) }}</text>
        </view>
      </view>

      <view class="list-footer">
        <text v-if="loading" class="footer-text">加载中...</text>
        <text v-else-if="!hasMore" class="footer-text">— 没有更多了 —</text>
        <text v-else class="footer-load-more" @click="loadMore">加载更多</text>
      </view>
    </view>

    <!-- 空状态 -->
    <view v-else class="empty-state">
      <text class="empty-icon">{{ activeTab === 'WITHDRAW' ? '💸' : '💰' }}</text>
      <text class="empty-text">{{ activeTab === 'WITHDRAW' ? '暂无提现记录' : '暂无流水记录' }}</text>
    </view>

    <!-- 提现弹窗 -->
    <view v-if="showWithdrawModal" class="modal-mask" @click="closeWithdrawModal">
      <view class="modal-content" @click.stop>
        <view class="modal-header">
          <text class="modal-title">提现到微信零钱</text>
          <view class="modal-close" @click="closeWithdrawModal">
            <text class="close-icon">✕</text>
          </view>
        </view>
        <view class="modal-body">
          <view class="form-group">
            <text class="form-label">提现金额</text>
            <view class="input-wrap">
              <text class="currency-symbol">¥</text>
              <input
                v-model="withdrawAmount"
                class="amount-input"
                type="digit"
                placeholder="请输入提现金额"
              />
            </view>
            <text class="form-hint">单笔提现最低 1 元，最高 5000 元</text>
            <text class="form-hint" v-if="Number(withdrawAmount) > 1000">
              大额提现（>1000元）需人工审核
            </text>
          </view>
          <view class="balance-tip">
            <text class="tip-text">可用余额：{{ balance.available.toFixed(2) }} 元</text>
          </view>
        </view>
        <view class="modal-footer">
          <view class="btn-cancel" @click="closeWithdrawModal">
            <text class="btn-text">取消</text>
          </view>
          <view
            class="btn-confirm"
            :class="{ disabled: !canWithdraw || withdrawing }"
            @click="submitWithdraw"
          >
            <text class="btn-text">{{ withdrawing ? '提现中...' : '确认提现' }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { walletApi, type WalletBalance, type Transaction } from '@/api/wallet';

const balance = ref<WalletBalance>({
  id: '',
  balance: 0,
  frozen: 0,
  available: 0,
});

const transactions = ref<Transaction[]>([]);
const page = ref(1);
const hasMore = ref(false);
const loading = ref(false);

const activeTab = ref<'ALL' | 'INCOME' | 'EXPENSE' | 'FREEZE' | 'UNFREEZE' | 'WITHDRAW'>('ALL');

const tabs = [
  { key: 'ALL' as const, label: '全部' },
  { key: 'INCOME' as const, label: '收入' },
  { key: 'EXPENSE' as const, label: '支出' },
  { key: 'FREEZE' as const, label: '冻结' },
  { key: 'UNFREEZE' as const, label: '解冻' },
  { key: 'WITHDRAW' as const, label: '提现' },
];

const showWithdrawModal = ref(false);
const withdrawAmount = ref('');
const withdrawing = ref(false);

const canWithdraw = computed(() => {
  const amount = Number(withdrawAmount.value);
  return amount >= 1 && amount <= balance.value.available && !withdrawing.value;
});

const filteredTransactions = computed(() => {
  if (activeTab.value === 'ALL') return transactions.value;
  if (activeTab.value === 'WITHDRAW') {
    return transactions.value.filter(
      (t) => t.description.includes('提现'),
    );
  }
  return transactions.value.filter((t) => t.type === activeTab.value);
});

function switchTab(key: string) {
  activeTab.value = key as typeof activeTab.value;
}

function getIcon(type: string): string {
  const map: Record<string, string> = {
    INCOME: '📈',
    EXPENSE: '📉',
    FREEZE: '🔒',
    UNFREEZE: '🔓',
  };
  return map[type] || '💰';
}

function getIconClass(type: string): string {
  const map: Record<string, string> = {
    INCOME: 'icon-income',
    EXPENSE: 'icon-expense',
    FREEZE: 'icon-freeze',
    UNFREEZE: 'icon-unfreeze',
  };
  return map[type] || '';
}

function getAmountClass(type: string): string {
  if (type === 'INCOME' || type === 'UNFREEZE') return 'amount-positive';
  return 'amount-negative';
}

function getAmountDisplay(tx: Transaction): string {
  if (tx.type === 'INCOME' || tx.type === 'UNFREEZE') {
    return `+${tx.amount.toFixed(2)}`;
  }
  return `-${tx.amount.toFixed(2)}`;
}

function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (days === 0) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (days < 7) return `${days}天前 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadBalance(): Promise<void> {
  try {
    balance.value = await walletApi.getBalance();
  } catch {
    // 使用默认值
  }
}

async function loadTransactions(reset = false): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  if (reset) page.value = 1;
  try {
    const result = await walletApi.getTransactions(page.value);
    if (reset) {
      transactions.value = result.items;
    } else {
      transactions.value.push(...result.items);
    }
    hasMore.value = result.hasMore;
  } catch {
    if (reset) transactions.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  if (!hasMore.value || loading.value) return;
  page.value++;
  await loadTransactions();
}

function openWithdrawModal(): void {
  withdrawAmount.value = '';
  showWithdrawModal.value = true;
}

function closeWithdrawModal(): void {
  if (withdrawing.value) return;
  showWithdrawModal.value = false;
  withdrawAmount.value = '';
}

async function submitWithdraw(): Promise<void> {
  if (!canWithdraw.value) return;

  const amount = Number(withdrawAmount.value);
  if (amount < 1) {
    uni.showToast({ title: '最低提现 1 元', icon: 'none' });
    return;
  }

  withdrawing.value = true;
  try {
    const result = await walletApi.withdraw(amount);
    uni.showToast({
      title: result.message || '提现申请成功',
      icon: result.status === 'SUCCESS' ? 'success' : 'none',
      duration: 2000,
    });
    showWithdrawModal.value = false;
    withdrawAmount.value = '';
    // 刷新余额和流水
    await Promise.all([loadBalance(), loadTransactions(true)]);
  } catch (err) {
    uni.showToast({
      title: (err as Error).message || '提现失败，请重试',
      icon: 'none',
      duration: 2000,
    });
  } finally {
    withdrawing.value = false;
  }
}

onMounted(async () => {
  await loadBalance();
  await loadTransactions(true);
});

onShow(async () => {
  await loadBalance();
  await loadTransactions(true);
});
</script>

<style lang="scss" scoped>
.wallet-page {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding-bottom: env(safe-area-inset-bottom);
}

// 余额卡片
.balance-card {
  margin: 24rpx;
  padding: 40rpx 32rpx;
  background: linear-gradient(135deg, #4caf50, #2e7d32);
  border-radius: 20rpx;
  color: #fff;
}

.balance-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32rpx;
}

.balance-title {
  font-size: 32rpx;
  font-weight: 600;
}

.withdraw-btn {
  padding: 12rpx 32rpx;
  background-color: rgba(255, 255, 255, 0.25);
  border-radius: 30rpx;
}

.withdraw-text {
  font-size: 28rpx;
  color: #fff;
}

.balance-main {
  display: flex;
  align-items: center;
}

.balance-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.balance-label {
  font-size: 24rpx;
  opacity: 0.85;
}

.balance-value {
  font-size: 48rpx;
  font-weight: 700;

  &.frozen {
    font-size: 36rpx;
  }
}

.balance-divider {
  width: 1rpx;
  height: 60rpx;
  background-color: rgba(255, 255, 255, 0.3);
  margin: 0 20rpx;
}

// Tab 切换
.tabs {
  display: flex;
  margin: 0 24rpx;
  background-color: #fff;
  border-radius: 16rpx;
  overflow: hidden;
}

.tab-item {
  flex: 1;
  padding: 24rpx 0;
  text-align: center;
  position: relative;

  &.active {
    .tab-label {
      color: #4caf50;
      font-weight: 600;
    }

    &::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 40rpx;
      height: 4rpx;
      background-color: #4caf50;
      border-radius: 2rpx;
    }
  }
}

.tab-label {
  font-size: 26rpx;
  color: #666;
}

// 流水列表
.transaction-list {
  margin: 24rpx;
  background-color: #fff;
  border-radius: 20rpx;
  overflow: hidden;
}

.transaction-item {
  display: flex;
  align-items: center;
  padding: 28rpx 24rpx;
  border-bottom: 1rpx solid #f5f5f5;

  &:last-of-type {
    border-bottom: none;
  }
}

.tx-icon {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #f0f0f0;
  flex-shrink: 0;

  &.icon-income {
    background-color: #e8f5e9;
  }

  &.icon-expense {
    background-color: #ffebee;
  }

  &.icon-freeze {
    background-color: #fff3e0;
  }

  &.icon-unfreeze {
    background-color: #e3f2fd;
  }
}

.icon-text {
  font-size: 36rpx;
}

.tx-info {
  flex: 1;
  margin-left: 20rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  overflow: hidden;
}

.tx-desc {
  font-size: 28rpx;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tx-time {
  font-size: 22rpx;
  color: #999;
}

.tx-amount {
  flex-shrink: 0;

  .amount-positive {
    color: #4caf50;
  }

  .amount-negative {
    color: #f44336;
  }
}

.tx-amount text {
  font-size: 32rpx;
  font-weight: 600;
}

.list-footer {
  padding: 28rpx;
  text-align: center;
}

.footer-text {
  font-size: 24rpx;
  color: #ccc;
}

.footer-load-more {
  font-size: 28rpx;
  color: #4caf50;
}

// 空状态
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80rpx 0;
  gap: 20rpx;
  background-color: #fff;
  margin: 24rpx;
  border-radius: 20rpx;
}

.empty-icon {
  font-size: 80rpx;
}

.empty-text {
  font-size: 28rpx;
  color: #999;
}

// 提现弹窗
.modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-content {
  width: 640rpx;
  background-color: #fff;
  border-radius: 24rpx;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32rpx;
  border-bottom: 1rpx solid #f0f0f0;
}

.modal-title {
  font-size: 34rpx;
  font-weight: 600;
  color: #333;
}

.modal-close {
  width: 60rpx;
  height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-icon {
  font-size: 32rpx;
  color: #999;
}

.modal-body {
  padding: 32rpx;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.form-label {
  font-size: 28rpx;
  color: #333;
}

.input-wrap {
  display: flex;
  align-items: center;
  border: 2rpx solid #e0e0e0;
  border-radius: 12rpx;
  padding: 0 24rpx;
  height: 96rpx;

  &:focus-within {
    border-color: #4caf50;
  }
}

.currency-symbol {
  font-size: 40rpx;
  color: #333;
  margin-right: 12rpx;
}

.amount-input {
  flex: 1;
  font-size: 40rpx;
  color: #333;
  height: 100%;
}

.form-hint {
  font-size: 22rpx;
  color: #999;
}

.balance-tip {
  margin-top: 24rpx;
  padding: 20rpx 24rpx;
  background-color: #f5f5f5;
  border-radius: 12rpx;
}

.tip-text {
  font-size: 26rpx;
  color: #666;
}

.modal-footer {
  display: flex;
  border-top: 1rpx solid #f0f0f0;
}

.btn-cancel,
.btn-confirm {
  flex: 1;
  padding: 32rpx 0;
  text-align: center;

  &.btn-cancel {
    border-right: 1rpx solid #f0f0f0;
  }

  &.btn-confirm {
    background-color: #4caf50;

    &.disabled {
      background-color: #c8e6c9;
    }

    .btn-text {
      color: #fff;
    }
  }
}

.btn-text {
  font-size: 32rpx;
  color: #333;
}
</style>
