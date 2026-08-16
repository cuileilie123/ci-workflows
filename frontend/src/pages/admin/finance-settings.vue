<template>
  <scroll-view class="finance-page" scroll-y>
    <view class="header">
      <text class="title">🏦 财务设置</text>
      <text class="subtitle">平台佣金收款账号（分账接收方配置）</text>
    </view>

    <!-- ========== 分账总控 ========== -->
    <view class="card">
      <view class="card-title">
        <text class="card-title-text">分账总控</text>
      </view>
      <view class="row-item switch-row">
        <view class="row-info">
          <text class="row-label">启用平台分账</text>
          <text class="row-hint">关闭后，所有资金留在主商户号，不触发分账 API</text>
        </view>
        <switch
          :checked="form.profitSharingEnabled"
          color="#4caf50"
          @change="(e: { detail: { value: boolean } }) => (form.profitSharingEnabled = e.detail.value)"
        />
      </view>
    </view>

    <view v-if="form.profitSharingEnabled">
      <!-- ========== 佣金收款账号 ========== -->
      <view class="card">
        <view class="card-title">
          <text class="card-title-text">平台佣金收款账号（分账接收方）</text>
          <text class="card-title-tip">新订单支付成功后，platformFee 将自动分到该账号</text>
        </view>

        <view class="row-item">
          <text class="row-label required">接收方类型</text>
          <picker
            :range="receiverTypeOptions"
            range-key="label"
            :value="receiverTypeIndex"
            @change="onReceiverTypeChange"
          >
            <view class="picker-box">
              {{ currentReceiverTypeLabel }} ›
            </view>
          </picker>
        </view>

        <view v-if="form.receiverType === 'MERCHANT_ID'" class="row-item">
          <text class="row-label required">接收方商户号</text>
          <input
            class="input-box"
            type="number"
            v-model="form.receiverMchId"
            placeholder="如 1600000000（8~32 位数字）"
            maxlength="32"
          />
        </view>

        <view v-if="form.receiverType === 'PERSONAL_OPENID'" class="row-item">
          <text class="row-label required">个人 OpenID</text>
          <input
            class="input-box"
            v-model="form.receiverOpenid"
            placeholder="如 oABC1234567890abcdef"
            maxlength="64"
          />
        </view>

        <view class="row-item">
          <text class="row-label">接收方名称</text>
          <input
            class="input-box"
            v-model="form.receiverName"
            placeholder="如 XX 科技有限公司（建议与微信商户平台登记一致）"
            maxlength="128"
          />
        </view>

        <view v-if="form.receiverType === 'PERSONAL_OPENID'" class="warn-box">
          <text class="warn-text">
            ⚠️ 接收方类型为「个人零钱」需先在微信商户平台完成个人实名认证，且分账比例有限制，推荐使用「微信支付商户号」。
          </text>
        </view>
      </view>
    </view>

    <!-- ========== 主商户号 / AppID（可选覆盖 env）========== -->
    <view class="card advanced" v-if="showAdvanced">
      <view class="card-title" @click="showAdvanced = !showAdvanced">
        <text class="card-title-text">主商户号 & AppID（高级，可选覆盖 .env）</text>
        <text class="expand">{{ expanded ? '收起 ▲' : '展开 ▼' }}</text>
      </view>
      <template v-if="expanded">
        <view class="row-item">
          <text class="row-label">主商户号</text>
          <input
            class="input-box"
            type="number"
            v-model="form.mainMchId"
            placeholder="留空则使用 .env 配置的 WX_MCH_ID"
            maxlength="32"
          />
        </view>
        <view class="row-item">
          <text class="row-label">小程序 AppID</text>
          <input
            class="input-box"
            v-model="form.mainAppId"
            placeholder="留空则使用 .env 配置的 WX_APP_ID（wx 开头 16 位）"
            maxlength="32"
          />
        </view>
      </template>
    </view>

    <!-- ========== 保存 ========== -->
    <view class="footer-bar">
      <button
        class="save-btn"
        :disabled="saving"
        :loading="saving"
        @click="onSave"
      >
        {{ saving ? '保存中...' : '保存设置' }}
      </button>
      <text class="updated-info" v-if="current?.updatedAt">
        上次更新: {{ formatTime(current.updatedAt) }}
      </text>
    </view>
  </scroll-view>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { financeSettingsApi, type FinanceSettingPayload } from '@/api/admin';
import type { PlatformFinanceSetting, ReceiverType } from '@/types';

interface ReceiverTypeOption {
  value: ReceiverType;
  label: string;
  hint: string;
}

const receiverTypeOptions: ReceiverTypeOption[] = [
  { value: 'MERCHANT_ID', label: '微信支付商户号（推荐）', hint: '独立分账商户号' },
  { value: 'PERSONAL_OPENID', label: '个人 OpenID（零钱）', hint: '需完成实名认证' },
];

const showAdvanced = ref(false);
const expanded = ref(false);
const saving = ref(false);
const current = ref<PlatformFinanceSetting | null>(null);

const emptyForm: FinanceSettingPayload = {
  profitSharingEnabled: true,
  receiverType: 'MERCHANT_ID',
  receiverMchId: '',
  receiverName: '',
  receiverOpenid: '',
  mainMchId: '',
  mainAppId: '',
};

const form = ref<FinanceSettingPayload>({ ...emptyForm });

const receiverTypeIndex = computed(
  () => receiverTypeOptions.findIndex((o) => o.value === form.value.receiverType) ?? 0,
);
const currentReceiverTypeLabel = computed(
  () => receiverTypeOptions[receiverTypeIndex.value]?.label ?? '选择类型',
);

function onReceiverTypeChange(e: any): void {
  const idx = Number(e.detail.value) || 0;
  form.value.receiverType = receiverTypeOptions[idx].value;
  // 切换类型时清空另一类型的冗余字段
  if (form.value.receiverType === 'MERCHANT_ID') {
    form.value.receiverOpenid = '';
  } else {
    form.value.receiverMchId = '';
  }
}

function formatTime(s: string | null | undefined): string {
  if (!s) return '-';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

async function load(): Promise<void> {
  try {
    const data = await financeSettingsApi.get();
    current.value = data;
    if (data) {
      form.value = {
        profitSharingEnabled: data.profitSharingEnabled,
        receiverType: data.receiverType,
        receiverMchId: data.receiverMchId ?? '',
        receiverName: data.receiverName ?? '',
        receiverOpenid: data.receiverOpenid ?? '',
        mainMchId: data.mainMchId ?? '',
        mainAppId: data.mainAppId ?? '',
      };
    }
  } catch (err: unknown) {
    uni.showToast({
      title: '加载失败：' + ((err as Error)?.message || '未知错误'),
      icon: 'none',
    });
  }
}

function validate(): string | null {
  if (form.value.profitSharingEnabled) {
    if (form.value.receiverType === 'MERCHANT_ID') {
      if (!/^\d{8,32}$/.test((form.value.receiverMchId || '').trim())) {
        return '商户号必须是 8~32 位数字';
      }
    } else if (form.value.receiverType === 'PERSONAL_OPENID') {
      if (!(form.value.receiverOpenid || '').trim()) {
        return '接收方类型为个人时，OpenID 必填';
      }
    }
  }
  if (form.value.mainMchId && !/^\d{8,32}$/.test(form.value.mainMchId.trim())) {
    return '主商户号格式不正确（8~32 位数字）';
  }
  if (form.value.mainAppId && !/^wx[a-f0-9]{16}$/.test(form.value.mainAppId.trim())) {
    return 'AppID 格式不正确（wx 开头 16 位）';
  }
  return null;
}

async function onSave(): Promise<void> {
  const err = validate();
  if (err) {
    uni.showToast({ title: err, icon: 'none' });
    return;
  }
  saving.value = true;
  try {
    const saved = await financeSettingsApi.save({
      ...form.value,
      receiverMchId: form.value.receiverMchId || null,
      receiverName: form.value.receiverName || null,
      receiverOpenid: form.value.receiverOpenid || null,
      mainMchId: form.value.mainMchId || null,
      mainAppId: form.value.mainAppId || null,
    });
    current.value = saved;
    uni.showToast({ title: '保存成功', icon: 'success' });
  } catch (e: unknown) {
    uni.showToast({
      title: '保存失败：' + ((e as Error)?.message || '未知错误'),
      icon: 'none',
    });
  } finally {
    saving.value = false;
  }
}

onMounted(() => load());
onShow(() => load());
</script>

<style lang="scss" scoped>
.finance-page {
  min-height: 100vh;
  padding: 24rpx;
  padding-bottom: 180rpx;
  background-color: #f5f5f5;
  box-sizing: border-box;
}

.header {
  padding: 32rpx 24rpx;
  background: linear-gradient(135deg, #4caf50, #00897b);
  border-radius: 20rpx;
  color: #fff;
  margin-bottom: 24rpx;
}
.title {
  display: block;
  font-size: 40rpx;
  font-weight: 700;
}
.subtitle {
  display: block;
  font-size: 26rpx;
  opacity: 0.92;
  margin-top: 8rpx;
}

.card {
  background: #fff;
  border-radius: 20rpx;
  padding: 24rpx 28rpx;
  margin-bottom: 20rpx;

  &.advanced {
    background-color: #fafafa;
    border: 2rpx dashed #e0e0e0;
  }
}

.card-title {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding-bottom: 16rpx;
  margin-bottom: 8rpx;
  border-bottom: 2rpx solid #f0f0f0;
}
.card-title-text {
  font-size: 30rpx;
  font-weight: 600;
  color: #333;
}
.card-title-tip {
  margin-top: 6rpx;
  display: block;
  font-size: 24rpx;
  color: #888;
}
.expand {
  font-size: 24rpx;
  color: #4caf50;
}

.row-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22rpx 0;
  border-bottom: 2rpx solid #f6f6f6;

  &:last-child {
    border-bottom: none;
  }

  &.switch-row {
    border-bottom: none;
    padding-bottom: 4rpx;
  }
}
.row-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.row-label {
  font-size: 28rpx;
  color: #333;
  min-width: 220rpx;
  font-weight: 500;

  &.required::before {
    content: '* ';
    color: #f44336;
  }
}
.row-hint {
  font-size: 22rpx;
  color: #999;
}

.input-box {
  flex: 1;
  text-align: right;
  font-size: 28rpx;
  color: #333;
  padding: 8rpx 12rpx;
}

.picker-box {
  font-size: 28rpx;
  color: #4caf50;
  padding: 8rpx 12rpx;
}

.warn-box {
  margin-top: 16rpx;
  padding: 16rpx;
  background-color: #fff8e1;
  border-radius: 12rpx;
}
.warn-text {
  font-size: 24rpx;
  line-height: 1.6;
  color: #b71c1c;
}

.footer-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 20rpx 28rpx 36rpx;
  background-color: #fff;
  box-shadow: 0 -4rpx 16rpx rgba(0, 0, 0, 0.05);
  z-index: 10;
}

.save-btn {
  width: 100%;
  height: 88rpx;
  line-height: 88rpx;
  font-size: 32rpx;
  font-weight: 600;
  border-radius: 44rpx;
  color: #fff;
  background-color: #4caf50;

  &[disabled] {
    opacity: 0.6;
  }
}

.updated-info {
  display: block;
  text-align: center;
  font-size: 22rpx;
  color: #aaa;
  margin-top: 10rpx;
}
</style>
