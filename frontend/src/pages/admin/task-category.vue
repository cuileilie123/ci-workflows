<template>
  <view class="page">
    <view class="top-bar">
      <text class="page-title">任务分类管理</text>
      <view class="add-btn" @click="openCreate"><text class="add-text">+ 新建分类</text></view>
    </view>

    <view v-if="categories.length" class="cat-list">
      <view v-for="cat in categories" :key="cat.id" class="cat-card" :class="{ inactive: !cat.isActive }">
        <view class="cat-head">
          <text class="cat-name">{{ cat.name }}</text>
          <text class="badge" :class="cat.isActive ? 'on' : 'off'">{{ cat.isActive ? '启用' : '停用' }}</text>
        </view>
        <view class="cat-meta">
          <text class="meta-text">编码：{{ cat.code }}</text>
          <text class="meta-text">排序：{{ cat.sort }}</text>
        </view>
        <view class="cat-actions">
          <view class="op-btn" @click="toggleActive(cat)">
            <text class="op-text">{{ cat.isActive ? '停用' : '启用' }}</text>
          </view>
          <view class="op-btn" @click="openEdit(cat)"><text class="op-text">编辑</text></view>
          <view class="op-btn danger" @click="onRemove(cat)"><text class="op-text">删除</text></view>
        </view>
      </view>
    </view>
    <view v-else class="empty"><text class="empty-text">暂无任务分类</text></view>

    <view v-if="showModal" class="modal-mask" @click="closeModal">
      <view class="modal-content" @click.stop>
        <view class="modal-header">
          <text class="modal-title">{{ editing ? '编辑分类' : '新建分类' }}</text>
          <view class="modal-close" @click="closeModal"><text class="close-icon">✕</text></view>
        </view>
        <view class="modal-body">
          <view class="form-group">
            <text class="form-label">分类名称</text>
            <input v-model="form.name" class="form-input" placeholder="如 跑腿送货" />
          </view>
          <view v-if="!editing" class="form-group">
            <text class="form-label">分类编码（大写英文，唯一）</text>
            <input v-model="form.code" class="form-input" placeholder="如 DELIVERY" />
          </view>
          <view class="form-group">
            <text class="form-label">图标 URL（可选）</text>
            <input v-model="form.icon" class="form-input" placeholder="https://..." />
          </view>
          <view class="form-group">
            <text class="form-label">排序（整数，升序）</text>
            <input v-model.number="form.sort" class="form-input" type="number" placeholder="0" />
          </view>
          <view class="form-group switch-row">
            <text class="form-label">启用</text>
            <switch :checked="form.isActive" @change="(e: any) => (form.isActive = e.detail.value)" />
          </view>
        </view>
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
import { ref, reactive } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { taskCategoryAdminApi } from '@/api/admin';
import type { TaskCategoryItem } from '@/types';

const categories = ref<TaskCategoryItem[]>([]);
const showModal = ref(false);
const editing = ref<TaskCategoryItem | null>(null);
const saving = ref(false);

const form = reactive({
  code: '',
  name: '',
  icon: '',
  sort: 0,
  isActive: true,
});

async function loadData(): Promise<void> {
  try {
    categories.value = await taskCategoryAdminApi.list(true);
  } catch {
    uni.showToast({ title: '加载失败', icon: 'none' });
  }
}

function openCreate(): void {
  editing.value = null;
  Object.assign(form, { code: '', name: '', icon: '', sort: 0, isActive: true });
  showModal.value = true;
}

function openEdit(cat: TaskCategoryItem): void {
  editing.value = cat;
  Object.assign(form, {
    code: cat.code,
    name: cat.name,
    icon: cat.icon ?? '',
    sort: cat.sort,
    isActive: cat.isActive,
  });
  showModal.value = true;
}

function closeModal(): void {
  if (saving.value) return;
  showModal.value = false;
}

async function onSave(): Promise<void> {
  if (!form.name) {
    uni.showToast({ title: '请输入分类名称', icon: 'none' });
    return;
  }
  if (!editing.value && !form.code) {
    uni.showToast({ title: '请输入分类编码', icon: 'none' });
    return;
  }
  saving.value = true;
  try {
    if (editing.value) {
      await taskCategoryAdminApi.update(editing.value.id, {
        name: form.name,
        icon: form.icon || undefined,
        sort: form.sort,
        isActive: form.isActive,
      });
    } else {
      await taskCategoryAdminApi.create({
        code: form.code,
        name: form.name,
        icon: form.icon || undefined,
        sort: form.sort,
        isActive: form.isActive,
      });
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

async function toggleActive(cat: TaskCategoryItem): Promise<void> {
  try {
    await taskCategoryAdminApi.update(cat.id, { isActive: !cat.isActive });
    uni.showToast({ title: cat.isActive ? '已停用' : '已启用', icon: 'success' });
    await loadData();
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '操作失败', icon: 'none' });
  }
}

async function onRemove(cat: TaskCategoryItem): Promise<void> {
  const ok = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '删除分类',
      content: `确定删除「${cat.name}」？该分类下存在任务时无法删除。`,
      success: (r) => resolve(!!r.confirm),
    });
  });
  if (!ok) return;
  try {
    await taskCategoryAdminApi.remove(cat.id);
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

.cat-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.cat-card {
  padding: 28rpx;
  background-color: #fff;
  border-radius: 20rpx;

  &.inactive {
    opacity: 0.6;
  }
}

.cat-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12rpx;
}

.cat-name {
  font-size: 32rpx;
  font-weight: 600;
  color: #333;
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

.cat-meta {
  display: flex;
  gap: 24rpx;
  margin-bottom: 16rpx;
}

.meta-text {
  font-size: 26rpx;
  color: #666;
}

.cat-actions {
  display: flex;
  gap: 16rpx;
  border-top: 1rpx solid #f0f0f0;
  padding-top: 16rpx;
}

.op-btn {
  padding: 12rpx 28rpx;
  background-color: #f0f0f0;
  border-radius: 24rpx;

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
  inset: 0;
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
