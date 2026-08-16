<template>
  <view class="bank-card-page">
    <!-- 已绑定银行卡列表 -->
    <view v-if="cards.length > 0" class="card-list">
      <view v-for="card in cards" :key="card.id" class="bank-card-item">
        <view class="card-top">
          <text class="bank-name">{{ card.bankName }}</text>
          <text v-if="card.isDefault" class="default-tag">默认</text>
        </view>
        <text class="card-number">{{ card.cardNumberMasked }}</text>
        <view class="card-bottom">
          <text class="holder-name">{{ card.holderName }}</text>
          <text class="delete-btn" @click="onDeleteCard(card)">删除</text>
        </view>
      </view>
    </view>

    <!-- 添加银行卡表单 -->
    <view class="form-card">
      <view class="form-header">
        <text class="form-title">{{ cards.length > 0 ? '添加新银行卡' : '绑定银行卡' }}</text>
        <text class="form-desc">持卡人姓名须与实名认证姓名一致</text>
      </view>

      <view class="field">
        <text class="label">持卡人姓名</text>
        <input
          v-model="form.holderName"
          class="input"
          placeholder="请输入持卡人姓名"
          placeholder-class="ph"
          maxlength="32"
        />
      </view>

      <view class="field">
        <text class="label">银行名称</text>
        <picker :range="bankOptions" :value="bankIndex" @change="onBankChange">
          <view class="picker" :class="{ ph: !form.bankName }">
            {{ form.bankName || '请选择银行' }}
          </view>
        </picker>
      </view>

      <view class="field">
        <text class="label">银行卡号</text>
        <input
          v-model="form.cardNumber"
          class="input"
          type="number"
          placeholder="请输入 16-19 位银行卡号"
          placeholder-class="ph"
          maxlength="19"
        />
      </view>

      <button class="submit-btn" :disabled="submitting" @click="onSubmit">
        {{ submitting ? '绑定中...' : '绑定银行卡' }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { verificationApi } from '@/api/verification';
import type { BankCardInfo } from '@/types';

const cards = ref<BankCardInfo[]>([]);
const submitting = ref(false);

const bankOptions = [
  '中国工商银行',
  '中国农业银行',
  '中国银行',
  '中国建设银行',
  '交通银行',
  '招商银行',
  '中国邮政储蓄银行',
  '中信银行',
  '中国光大银行',
  '华夏银行',
  '中国民生银行',
  '兴业银行',
  '广发银行',
  '平安银行',
  '浦发银行',
  '其他银行',
];
const bankIndex = ref(0);

const form = ref({
  holderName: '',
  bankName: '',
  cardNumber: '',
});

async function loadCards(): Promise<void> {
  try {
    cards.value = await verificationApi.listBankCards();
  } catch {
    cards.value = [];
  }
}

function onBankChange(e: { detail: { value: number } }): void {
  bankIndex.value = e.detail.value;
  form.value.bankName = bankOptions[e.detail.value];
}

function validate(): boolean {
  if (!form.value.holderName.trim()) {
    uni.showToast({ title: '请输入持卡人姓名', icon: 'none' });
    return false;
  }
  if (!form.value.bankName) {
    uni.showToast({ title: '请选择银行', icon: 'none' });
    return false;
  }
  if (!/^\d{16,19}$/.test(form.value.cardNumber.trim())) {
    uni.showToast({ title: '银行卡号须为 16-19 位数字', icon: 'none' });
    return false;
  }
  return true;
}

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  if (!validate()) return;

  submitting.value = true;
  try {
    await verificationApi.addBankCard({
      holderName: form.value.holderName.trim(),
      bankName: form.value.bankName,
      cardNumber: form.value.cardNumber.trim(),
    });
    uni.showToast({ title: '银行卡绑定成功', icon: 'success' });
    form.value = { holderName: '', bankName: '', cardNumber: '' };
    await loadCards();
  } catch (err) {
    uni.showToast({ title: (err as Error).message || '绑定失败', icon: 'none' });
  } finally {
    submitting.value = false;
  }
}

function onDeleteCard(card: BankCardInfo): void {
  uni.showModal({
    title: '删除银行卡',
    content: `确认删除 ${card.bankName} 尾号 ${card.lastFour} 的银行卡吗？`,
    success: async (res) => {
      if (!res.confirm) return;
      try {
        await verificationApi.deleteBankCard(card.id);
        uni.showToast({ title: '删除成功', icon: 'success' });
        await loadCards();
      } catch (err) {
        uni.showToast({ title: (err as Error).message || '删除失败', icon: 'none' });
      }
    },
  });
}

onShow(() => {
  loadCards();
});
</script>

<style lang="scss" scoped>
.bank-card-page {
  min-height: 100vh;
  padding: 24rpx;
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  background-color: #f5f5f5;
}

// 银行卡列表
.card-list {
  margin-bottom: 24rpx;
}

.bank-card-item {
  background: linear-gradient(135deg, #5c6bc0, #3949ab);
  border-radius: 20rpx;
  padding: 32rpx 28rpx;
  margin-bottom: 20rpx;
  color: #fff;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.bank-name {
  font-size: 32rpx;
  font-weight: 600;
}

.default-tag {
  padding: 4rpx 16rpx;
  background-color: rgba(255, 255, 255, 0.25);
  border-radius: 16rpx;
  font-size: 22rpx;
}

.card-number {
  font-size: 40rpx;
  font-weight: 700;
  letter-spacing: 4rpx;
}

.card-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.holder-name {
  font-size: 28rpx;
  opacity: 0.9;
}

.delete-btn {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.8);
  padding: 8rpx 20rpx;
  background-color: rgba(255, 255, 255, 0.15);
  border-radius: 20rpx;
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

.picker {
  height: 96rpx;
  border: 2rpx solid #e0e0e0;
  border-radius: 12rpx;
  padding: 0 24rpx;
  font-size: 30rpx;
  color: #333;
  line-height: 96rpx;

  &.ph {
    color: #ccc;
  }
}

.ph {
  color: #ccc;
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
