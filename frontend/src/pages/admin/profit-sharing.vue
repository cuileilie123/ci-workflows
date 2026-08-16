<template>
  <view class="page">
    <view class="top-bar">
      <text class="page-title">分佣比例管理</text>
      <view class="add-btn" @click="openCreate"><text class="add-text">+ 新建规则</text></view>
    </view>

    <!-- 微信渠道费率（只读） -->
    <view class="wechat-fee">
      <view class="fee-row">
        <text class="fee-label">微信支付渠道费率</text>
        <text class="fee-value">{{ wechatPercent }}%</text>
      </view>
      <text class="fee-desc">{{ wechatDesc }}（底层硬编码，不可修改）</text>
      <text class="fee-hint">接单者收入 = 订单总额 - 平台抽佣 - 微信渠道费</text>
    </view>

    <!-- 规则列表 -->
    <view v-if="rules.length" class="rule-list">
      <view v-for="rule in rules" :key="rule.id" class="rule-card" :class="{ inactive: !rule.isActive }">
        <view class="rule-head">
          <text class="rule-name">{{ rule.name }}</text>
          <view class="badge-row">
            <text class="mode-tag" :class="rule.mode.toLowerCase()">{{ rule.mode === 'FLAT' ? '单一比例' : '分段抽佣' }}</text>
            <text class="badge" :class="rule.isActive ? 'on' : 'off'">{{ rule.isActive ? '启用' : '停用' }}</text>
          </view>
        </view>

        <!-- FLAT 模式展示 -->
        <view v-if="rule.mode === 'FLAT'" class="rule-meta">
          <text class="meta-text">{{ rule.categoryName || '全局默认' }}</text>
          <text class="meta-text">平台 {{ (rule.platformRate * 100).toFixed(2) }}%</text>
          <text class="meta-text">接单者 {{ (rule.helperRate * 100).toFixed(2) }}%</text>
        </view>
        <view v-if="rule.mode === 'FLAT' && (rule.minPlatformFee !== null || rule.maxPlatformFee !== null)" class="rule-meta">
          <text class="meta-text">最低 ¥{{ rule.minPlatformFee ?? '-' }} / 最高 ¥{{ rule.maxPlatformFee ?? '-' }}</text>
        </view>

        <!-- TIERED 模式展示 -->
        <view v-if="rule.mode === 'TIERED'" class="tier-display">
          <text class="meta-text">{{ rule.categoryName || '全局默认' }}</text>
          <view v-if="rule.tiers" class="tier-list">
            <view v-for="(tier, idx) in rule.tiers" :key="idx" class="tier-row">
              <text class="tier-range">¥{{ tier.rangeStart }} - {{ tier.rangeEnd === null ? '∞' : '¥' + tier.rangeEnd }}</text>
              <text class="tier-rate">平台 {{ (tier.platformRate * 100).toFixed(2) }}%</text>
              <text class="tier-helper">接单者 {{ ((1 - tier.platformRate - 0.006) * 100).toFixed(2) }}%</text>
            </view>
          </view>
        </view>

        <view class="rule-actions">
          <view class="op-btn" @click="openEdit(rule)"><text class="op-text">编辑</text></view>
          <view class="op-btn danger" @click="onRemove(rule)"><text class="op-text">删除</text></view>
        </view>
      </view>
    </view>
    <view v-else class="empty"><text class="empty-text">暂无分账规则</text></view>

    <!-- 编辑弹窗 -->
    <view v-if="showModal" class="modal-mask" @click="closeModal">
      <view class="modal-content" @click.stop>
        <view class="modal-header">
          <text class="modal-title">{{ editing ? '编辑规则' : '新建规则' }}</text>
          <view class="modal-close" @click="closeModal"><text class="close-icon">✕</text></view>
        </view>
        <scroll-view class="modal-body" scroll-y>
          <view class="form-group">
            <text class="form-label">规则名称</text>
            <input v-model="form.name" class="form-input" placeholder="如 跑腿送货默认分账" />
          </view>

          <!-- 模式选择 -->
          <view class="form-group">
            <text class="form-label">抽佣模式</text>
            <view class="mode-selector">
              <view class="mode-option" :class="{ active: form.mode === 'FLAT' }" @click="switchMode('FLAT')">
                <text>单一比例</text>
              </view>
              <view class="mode-option" :class="{ active: form.mode === 'TIERED' }" @click="switchMode('TIERED')">
                <text>分段抽佣</text>
              </view>
            </view>
          </view>

          <!-- FLAT 模式表单 -->
          <block v-if="form.mode === 'FLAT'">
            <view class="form-group">
              <text class="form-label">平台抽成比例 (0-1)</text>
              <input v-model.number="form.platformRate" class="form-input" type="digit" placeholder="0.1 = 10%" />
              <text class="form-hint">接单者比例 = 1 - {{ (form.platformRate || 0) * 100 }}% - 0.6% = {{ flatHelperDisplay }}</text>
            </view>
            <view class="form-group">
              <text class="form-label">最低平台抽成（元，可选）</text>
              <input v-model.number="form.minPlatformFee" class="form-input" type="digit" placeholder="0.5" />
            </view>
            <view class="form-group">
              <text class="form-label">最高平台抽成（元，可选）</text>
              <input v-model.number="form.maxPlatformFee" class="form-input" type="digit" placeholder="50" />
            </view>
          </block>

          <!-- TIERED 模式表单 -->
          <block v-if="form.mode === 'TIERED'">
            <view class="form-group">
              <text class="form-label">分段抽佣区间</text>
              <text class="form-hint">类似个人所得税累进计算，每段设置金额区间和对应平台抽佣比例</text>
            </view>

            <view v-for="(tier, idx) in form.tiers" :key="idx" class="tier-edit-card">
              <view class="tier-edit-head">
                <text class="tier-edit-title">第 {{ Number(idx) + 1 }} 段</text>
                <view v-if="form.tiers.length > 1" class="tier-del-btn" @click="removeTier(idx)">
                  <text class="tier-del-text">删除</text>
                </view>
              </view>
              <view class="tier-edit-row">
                <view class="tier-edit-col">
                  <text class="form-label">起始金额（元）</text>
                  <input
                    :value="String(tier.rangeStart)"
                    class="form-input"
                    type="digit"
                    placeholder="0"
                    :disabled="idx === 0"
                    @input="onTierInput(idx, 'rangeStart', $event)"
                  />
                </view>
                <view class="tier-edit-col">
                  <text class="form-label">结束金额（元）</text>
                  <input
                    :value="tier.rangeEnd === null ? '' : String(tier.rangeEnd)"
                    class="form-input"
                    type="digit"
                    :placeholder="idx === form.tiers.length - 1 ? '留空=无上限' : '必填'"
                    @input="onTierInput(idx, 'rangeEnd', $event)"
                  />
                </view>
              </view>
              <view class="tier-edit-col">
                <text class="form-label">平台抽佣比例</text>
                <input
                  :value="String(tier.platformRate)"
                  class="form-input"
                  type="digit"
                  placeholder="0.05 = 5%"
                  @input="onTierInput(idx, 'platformRate', $event)"
                />
                <text class="form-hint">接单者比例 = {{ ((1 - (tier.platformRate || 0) - 0.006) * 100).toFixed(2) }}%</text>
              </view>
            </view>

            <view class="add-tier-btn" @click="addTier">
              <text class="add-tier-text">+ 添加区间</text>
            </view>

            <!-- 预览计算 -->
            <view v-if="previewAmount > 0" class="preview-box">
              <text class="preview-title">抽佣预览（订单金额 ¥{{ previewAmount }}）</text>
              <text class="preview-line">平台抽佣：¥{{ previewResult.platformFee }}</text>
              <text class="preview-line">微信渠道费：¥{{ previewResult.wechatFee }}</text>
              <text class="preview-line">接单者收入：¥{{ previewResult.helperAmount }}</text>
            </view>

            <view class="form-group">
              <text class="form-label">预览订单金额（可选）</text>
              <input v-model.number="previewAmount" class="form-input" type="digit" placeholder="输入金额查看抽佣预览" />
            </view>
          </block>

          <view class="form-group">
            <text class="form-label">优先级（整数，越大越先匹配）</text>
            <input v-model.number="form.priority" class="form-input" type="number" placeholder="0" />
          </view>
          <view class="form-group switch-row">
            <text class="form-label">启用</text>
            <switch :checked="form.isActive" @change="(e: any) => (form.isActive = e.detail.value)" />
          </view>
        </scroll-view>
        <view class="modal-footer">
          <view class="btn-cancel" @click="closeModal"><text class="btn-text">取消</text></view>
          <view class="btn-confirm" :class="{ disabled: saving }" @click="onSave">
            <text class="btn-text">{{ saving ? '保存中...' : '保存' }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { profitSharingAdminApi, profitSharingUserApi, type ProfitRulePayload } from '@/api/admin';
import type { ProfitSharingRule, WechatFeeRate, CommissionTier } from '@/types';

const WECHAT_RATE = 0.006;

const rules = ref<ProfitSharingRule[]>([]);
const wechatFee = ref<WechatFeeRate>({ rate: WECHAT_RATE, percent: 0.6, description: '微信支付平台官方收取0.6%渠道手续费，从接单者收入中优先扣除' });
const showModal = ref(false);
const editing = ref<ProfitSharingRule | null>(null);
const saving = ref(false);
const previewAmount = ref(0);

const wechatPercent = computed(() => wechatFee.value.percent);
const wechatDesc = computed(() => wechatFee.value.description);

const form = reactive<{
  name: string;
  mode: 'FLAT' | 'TIERED';
  platformRate: number;
  tiers: CommissionTier[];
  minPlatformFee: number | undefined;
  maxPlatformFee: number | undefined;
  isActive: boolean;
  priority: number;
}>({
  name: '',
  mode: 'FLAT',
  platformRate: 0.1,
  tiers: [],
  minPlatformFee: undefined,
  maxPlatformFee: undefined,
  isActive: true,
  priority: 0,
});

const flatHelperDisplay = computed(() => {
  const h = 1 - (form.platformRate || 0) - WECHAT_RATE;
  return `${(h * 100).toFixed(2)}%`;
});

/** 分段抽佣预览计算 */
const previewResult = computed(() => {
  if (!previewAmount.value || previewAmount.value <= 0 || form.tiers.length === 0) {
    return { platformFee: '0.00', wechatFee: '0.00', helperAmount: '0.00' };
  }
  const total = previewAmount.value;
  const wechatFeeAmount = Math.round(total * WECHAT_RATE * 100) / 100;
  let platformFee = 0;
  let remaining = total;
  const sorted = [...form.tiers].sort((a, b) => a.rangeStart - b.rangeStart);
  for (const tier of sorted) {
    if (remaining <= 0) break;
    const tierEnd = tier.rangeEnd !== null ? tier.rangeEnd : Infinity;
    const tierWidth = tierEnd - tier.rangeStart;
    const amountInTier = Math.min(remaining, tierWidth);
    if (amountInTier <= 0) continue;
    platformFee += amountInTier * (tier.platformRate || 0);
    remaining -= amountInTier;
  }
  platformFee = Math.round(platformFee * 100) / 100;
  const helperAmount = Math.round((total - platformFee - wechatFeeAmount) * 100) / 100;
  return {
    platformFee: platformFee.toFixed(2),
    wechatFee: wechatFeeAmount.toFixed(2),
    helperAmount: helperAmount.toFixed(2),
  };
});

async function loadData(): Promise<void> {
  try {
    const [list, fee] = await Promise.all([
      profitSharingAdminApi.list(),
      profitSharingUserApi.wechatFeeRate(),
    ]);
    rules.value = list;
    wechatFee.value = fee;
  } catch {
    uni.showToast({ title: '加载失败', icon: 'none' });
  }
}

function switchMode(mode: 'FLAT' | 'TIERED'): void {
  form.mode = mode;
  if (mode === 'TIERED' && form.tiers.length === 0) {
    form.tiers = [{ rangeStart: 0, rangeEnd: null, platformRate: 0.05 }];
  }
}

function addTier(): void {
  const lastTier = form.tiers[form.tiers.length - 1];
  const newStart = lastTier?.rangeEnd ?? 0;
  if (lastTier && lastTier.rangeEnd === null) {
    uni.showToast({ title: '请先为上一段设置结束金额', icon: 'none' });
    return;
  }
  form.tiers.push({ rangeStart: newStart, rangeEnd: null, platformRate: 0.1 });
}

function removeTier(idx: number): void {
  if (idx === 0) {
    uni.showToast({ title: '第一段不可删除', icon: 'none' });
    return;
  }
  // 删除后，将新的最后一段的 rangeEnd 设为 null
  form.tiers.splice(idx, 1);
  const lastIdx = form.tiers.length - 1;
  if (lastIdx >= 0) {
    form.tiers[lastIdx].rangeEnd = null;
  }
}

function onTierInput(idx: number, field: 'rangeStart' | 'rangeEnd' | 'platformRate', e: any): void {
  const val = e.detail.value;
  if (field === 'rangeEnd') {
    form.tiers[idx].rangeEnd = val === '' ? null : Number(val);
    // 自动填充下一段的 rangeStart
    if (idx < form.tiers.length - 1 && val !== '') {
      form.tiers[idx + 1].rangeStart = Number(val);
    }
  } else {
    (form.tiers[idx] as any)[field] = val === '' ? 0 : Number(val);
  }
}

function openCreate(): void {
  editing.value = null;
  form.name = '';
  form.mode = 'FLAT';
  form.platformRate = 0.1;
  form.tiers = [];
  form.minPlatformFee = undefined;
  form.maxPlatformFee = undefined;
  form.isActive = true;
  form.priority = 0;
  previewAmount.value = 0;
  showModal.value = true;
}

function openEdit(rule: ProfitSharingRule): void {
  editing.value = rule;
  form.name = rule.name;
  form.mode = rule.mode;
  form.platformRate = rule.platformRate;
  form.tiers = rule.tiers ? rule.tiers.map(t => ({ ...t })) : [];
  form.minPlatformFee = rule.minPlatformFee ?? undefined;
  form.maxPlatformFee = rule.maxPlatformFee ?? undefined;
  form.isActive = rule.isActive;
  form.priority = rule.priority;
  previewAmount.value = 0;
  showModal.value = true;
}

function closeModal(): void {
  if (saving.value) return;
  showModal.value = false;
}

async function onSave(): Promise<void> {
  if (!form.name || form.name.length < 2) {
    uni.showToast({ title: '规则名称至少 2 字', icon: 'none' });
    return;
  }

  const payload: ProfitRulePayload = {
    name: form.name,
    mode: form.mode,
    isActive: form.isActive,
    priority: form.priority ?? 0,
  };

  if (form.mode === 'FLAT') {
    const platformRate = Number(form.platformRate);
    if (isNaN(platformRate) || platformRate < 0 || platformRate > 1) {
      uni.showToast({ title: '平台抽成比例需在 0-1 之间', icon: 'none' });
      return;
    }
    payload.platformRate = platformRate;
    payload.minPlatformFee = form.minPlatformFee;
    payload.maxPlatformFee = form.maxPlatformFee;
  } else {
    // TIERED 模式验证
    if (!form.tiers || form.tiers.length === 0) {
      uni.showToast({ title: '至少需要 1 个区间', icon: 'none' });
      return;
    }
    // 验证第一段起始为 0
    const sorted = [...form.tiers].sort((a, b) => a.rangeStart - b.rangeStart);
    if (sorted[0].rangeStart !== 0) {
      uni.showToast({ title: '第一段起始金额必须为 0', icon: 'none' });
      return;
    }
    // 验证连续性
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].rangeEnd === null) {
        uni.showToast({ title: `第 ${i + 1} 段需要设置结束金额`, icon: 'none' });
        return;
      }
      if (Math.abs((sorted[i].rangeEnd as number) - sorted[i + 1].rangeStart) > 0.01) {
        uni.showToast({ title: `第 ${i + 1} 段结束金额需等于第 ${i + 2} 段起始金额`, icon: 'none' });
        return;
      }
    }
    payload.tiers = sorted;
  }

  saving.value = true;
  try {
    if (editing.value) {
      await profitSharingAdminApi.update(editing.value.id, payload);
    } else {
      await profitSharingAdminApi.create(payload);
    }
    uni.showToast({ title: '保存成功', icon: 'success' });
    showModal.value = false;
    await loadData();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '保存失败', icon: 'none' });
  } finally {
    saving.value = false;
  }
}

async function onRemove(rule: ProfitSharingRule): Promise<void> {
  const ok = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '删除规则',
      content: `确定删除「${rule.name}」？`,
      success: (r) => resolve(!!r.confirm),
    });
  });
  if (!ok) return;
  try {
    await profitSharingAdminApi.remove(rule.id);
    uni.showToast({ title: '已删除', icon: 'success' });
    await loadData();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '删除失败', icon: 'none' });
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
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24rpx;
}

.page-title {
  font-size: 36rpx;
  font-weight: 700;
  color: #333;
}

.add-btn {
  padding: 12rpx 28rpx;
  background-color: #4caf50;
  border-radius: 30rpx;
}

.add-text {
  color: #fff;
  font-size: 26rpx;
}

.wechat-fee {
  padding: 28rpx;
  background-color: #fff8e1;
  border-radius: 16rpx;
  margin-bottom: 24rpx;
  border-left: 6rpx solid #ffb300;
}

.fee-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.fee-label {
  font-size: 28rpx;
  color: #5d4037;
  font-weight: 600;
}

.fee-value {
  font-size: 36rpx;
  font-weight: 700;
  color: #e65100;
}

.fee-desc {
  font-size: 22rpx;
  color: #8d6e63;
  margin-top: 8rpx;
  display: block;
}

.fee-hint {
  font-size: 22rpx;
  color: #6d4c41;
  margin-top: 4rpx;
  display: block;
}

.rule-list {
  display: flex;
  flex-direction: column;
}

.rule-card {
  padding: 28rpx;
  background-color: #fff;
  border-radius: 20rpx;
  margin-bottom: 20rpx;

  &.inactive {
    opacity: 0.6;
  }
}

.rule-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16rpx;
}

.rule-name {
  font-size: 32rpx;
  font-weight: 600;
  color: #333;
}

.badge-row {
  display: flex;
  align-items: center;
}

.mode-tag {
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  font-size: 20rpx;
  margin-right: 8rpx;

  &.flat {
    background-color: #e3f2fd;
    color: #1565c0;
  }

  &.tiered {
    background-color: #f3e5f5;
    color: #7b1fa2;
  }
}

.badge {
  padding: 4rpx 16rpx;
  border-radius: 20rpx;
  font-size: 22rpx;

  &.on {
    background-color: #e8f5e9;
    color: #2e7d32;
  }

  &.off {
    background-color: #ffebee;
    color: #c62828;
  }
}

.rule-meta {
  display: flex;
  flex-wrap: wrap;
  margin-bottom: 12rpx;
}

.meta-text {
  font-size: 26rpx;
  color: #666;
  margin-right: 24rpx;
}

.tier-display {
  margin-bottom: 12rpx;
}

.tier-list {
  margin-top: 8rpx;
}

.tier-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10rpx 0;
  border-bottom: 1rpx solid #f5f5f5;
}

.tier-range {
  font-size: 24rpx;
  color: #555;
  flex: 1;
}

.tier-rate {
  font-size: 24rpx;
  color: #e65100;
  margin-right: 16rpx;
}

.tier-helper {
  font-size: 24rpx;
  color: #2e7d32;
}

.rule-actions {
  display: flex;
  margin-top: 16rpx;
  border-top: 1rpx solid #f0f0f0;
  padding-top: 16rpx;
}

.op-btn {
  padding: 12rpx 32rpx;
  background-color: #f0f0f0;
  border-radius: 24rpx;
  margin-right: 20rpx;

  &.danger {
    background-color: #ffebee;
  }
}

.op-text {
  font-size: 26rpx;
  color: #333;
}

.danger .op-text {
  color: #c62828;
}

.empty {
  padding: 120rpx 0;
  text-align: center;
}

.empty-text {
  font-size: 28rpx;
  color: #999;
}

.modal-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-content {
  width: 680rpx;
  height: 85vh;
  background-color: #fff;
  border-radius: 24rpx;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 28rpx 32rpx;
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
  padding: 24rpx 32rpx;
  flex: 1;
  height: 0;
}

.form-group {
  margin-bottom: 24rpx;
}

.form-label {
  font-size: 26rpx;
  color: #555;
  display: block;
  margin-bottom: 12rpx;
}

.form-input {
  width: 100%;
  height: 80rpx;
  border: 2rpx solid #e0e0e0;
  border-radius: 12rpx;
  padding: 0 20rpx;
  font-size: 28rpx;
  box-sizing: border-box;
}

.form-hint {
  font-size: 22rpx;
  color: #999;
  margin-top: 8rpx;
  display: block;
}

.mode-selector {
  display: flex;
  margin-bottom: 8rpx;
}

.mode-option {
  flex: 1;
  padding: 20rpx 0;
  text-align: center;
  background-color: #f5f5f5;
  font-size: 28rpx;
  color: #666;

  &:first-child {
    border-radius: 12rpx 0 0 12rpx;
  }

  &:last-child {
    border-radius: 0 12rpx 12rpx 0;
  }

  &.active {
    background-color: #4caf50;
    color: #fff;
  }
}

.tier-edit-card {
  padding: 20rpx;
  background-color: #fafafa;
  border-radius: 16rpx;
  margin-bottom: 16rpx;
  border: 2rpx solid #e0e0e0;
}

.tier-edit-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12rpx;
}

.tier-edit-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #333;
}

.tier-del-btn {
  padding: 6rpx 20rpx;
  background-color: #ffebee;
  border-radius: 16rpx;
}

.tier-del-text {
  font-size: 24rpx;
  color: #c62828;
}

.tier-edit-row {
  display: flex;
  margin-bottom: 12rpx;
}

.tier-edit-col {
  flex: 1;
  margin-right: 12rpx;

  &:last-child {
    margin-right: 0;
  }
}

.add-tier-btn {
  padding: 20rpx;
  text-align: center;
  background-color: #e8f5e9;
  border-radius: 12rpx;
  margin-bottom: 16rpx;
  border: 2rpx dashed #4caf50;
}

.add-tier-text {
  font-size: 28rpx;
  color: #2e7d32;
}

.preview-box {
  padding: 20rpx;
  background-color: #e3f2fd;
  border-radius: 12rpx;
  margin-bottom: 16rpx;
}

.preview-title {
  font-size: 26rpx;
  font-weight: 600;
  color: #1565c0;
  display: block;
  margin-bottom: 8rpx;
}

.preview-line {
  font-size: 24rpx;
  color: #333;
  display: block;
  margin-bottom: 4rpx;
}

.switch-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-footer {
  display: flex;
  border-top: 1rpx solid #f0f0f0;
}

.btn-cancel,
.btn-confirm {
  flex: 1;
  padding: 28rpx 0;
  text-align: center;
}

.btn-cancel {
  border-right: 1rpx solid #f0f0f0;
}

.btn-confirm {
  background-color: #4caf50;

  &.disabled {
    background-color: #c8e6c9;
  }

  .btn-text {
    color: #fff;
  }
}

.btn-text {
  font-size: 30rpx;
  color: #333;
}
</style>
