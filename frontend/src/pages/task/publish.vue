<template>
  <view class="publish-page">
    <view class="form-card">
      <!-- 标题 -->
      <view class="field">
        <view class="label"><text class="req">*</text><text class="label-text">标题</text></view>
        <input
          v-model="form.title"
          class="input"
          :class="{ 'input-err': errors.title }"
          placeholder="一句话描述需求（2-50字）"
          placeholder-class="ph"
          maxlength="50"
          @blur="validateField('title')"
        />
        <text v-if="errors.title" class="err">{{ errors.title }}</text>
      </view>

      <!-- 分类 -->
      <view class="field">
        <view class="label"><text class="req">*</text><text class="label-text">分类</text></view>
        <picker :range="categoryLabels" :value="categoryIndex" @change="onCategoryChange">
          <view class="picker">{{ categoryLabels[categoryIndex] }}</view>
        </picker>
      </view>

      <!-- 描述 -->
      <view class="field">
        <view class="label"><text class="req">*</text><text class="label-text">描述</text></view>
        <textarea
          v-model="form.description"
          class="textarea"
          :class="{ 'input-err': errors.description }"
          placeholder="详细说明任务内容、要求等（10-500字）"
          placeholder-class="ph"
          maxlength="500"
          :auto-height="true"
          @blur="validateField('description')"
        />
        <text v-if="errors.description" class="err">{{ errors.description }}</text>
      </view>

      <!-- 价格 -->
      <view class="field row-field">
        <view class="sub-field">
          <view class="label"><text class="req">*</text><text class="label-text">报酬（元）</text></view>
          <input
            v-model="form.price"
            class="input"
            :class="{ 'input-err': errors.price }"
            type="digit"
            placeholder="0.01-10000"
            placeholder-class="ph"
            @blur="validateField('price')"
          />
          <text v-if="errors.price" class="err">{{ errors.price }}</text>
        </view>
        <view class="sub-field">
          <view class="label"><text class="req">*</text><text class="label-text">截止时间</text></view>
          <view class="expire-chips">
            <view
              v-for="opt in expireOptions"
              :key="opt.value"
              class="chip"
              :class="{ 'chip-active': expireSel === opt.value }"
              @tap="expireSel = opt.value"
            >
              {{ opt.label }}
            </view>
          </view>
        </view>
      </view>

      <!-- 紧急程度 -->
      <view class="field">
        <view class="label"><text class="req">*</text><text class="label-text">紧急程度</text></view>
        <view class="urgency-chips">
          <view
            v-for="opt in urgencyOptions"
            :key="opt.value"
            class="chip"
            :class="{ 'chip-active': form.urgency === opt.value }"
            @tap="form.urgency = opt.value"
          >
            {{ opt.label }}
          </view>
        </view>
        <text v-if="errors.urgency" class="err">{{ errors.urgency }}</text>
      </view>

      <!-- 位置 -->
      <view class="field">
        <view class="label"><text class="req">*</text><text class="label-text">位置</text></view>
        <view class="loc-picker" :class="{ 'input-err': errors.address }" @tap="onChooseLocation">
          <text v-if="form.address" class="loc-text">{{ form.address }}</text>
          <text v-else class="ph">点击选择地图位置</text>
          <text class="loc-arrow">›</text>
        </view>
        <text v-if="errors.address" class="err">{{ errors.address }}</text>
      </view>

      <!-- 图片（选填） -->
      <view class="field">
        <view class="label"><text class="label-text">图片</text><text class="optional-tag">（选填，最多 6 张）</text></view>
        <view class="img-grid">
          <view v-for="(img, idx) in form.images" :key="idx" class="img-item">
            <image class="img" :src="img.url" mode="aspectFill" />
            <view v-if="img.uploading" class="img-mask">
              <text class="img-progress">{{ img.progress }}%</text>
            </view>
            <view v-else class="img-del" @tap="onRemoveImage(idx)">×</view>
          </view>
          <view
            v-if="form.images.length < 6"
            class="img-add"
            @tap="onChooseImage"
          >
            <text class="img-add-icon">+</text>
            <text class="img-add-text">添加图片</text>
          </view>
        </view>
      </view>
    </view>

    <button class="submit-btn" :disabled="submitting" @click="onSubmit">
      {{ submitting ? '发布中...' : '发布任务' }}
    </button>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { taskApi, uploadImage } from '@/api';
import { TASK_CATEGORY_LABELS } from '@/types';
import type { TaskCategory } from '@/types';
import { tracker, EVENTS } from '@/utils/track';
import { subscribeOnTaskPublish } from '@/utils/subscribe';
import { useUserStore } from '@/store/user';

const userStore = useUserStore();

interface ImageItem {
  url: string;
  fileKey: string;
  uploading: boolean;
  progress: number;
}

const categoryKeys = Object.keys(TASK_CATEGORY_LABELS) as TaskCategory[];
const categoryLabels = categoryKeys.map((k) => TASK_CATEGORY_LABELS[k]);

const expireOptions = [
  { label: '1小时', value: 1 },
  { label: '6小时', value: 6 },
  { label: '24小时', value: 24 },
  { label: '3天', value: 72 },
  { label: '7天', value: 168 },
];

const urgencyOptions = [
  { label: '一般', value: 'NORMAL' },
  { label: '紧急', value: 'HIGH' },
  { label: '非常紧急', value: 'URGENT' },
];

const form = ref({
  title: '',
  description: '',
  price: '',
  lat: 0,
  lng: 0,
  address: '',
  urgency: 'NORMAL', // 紧急程度：LOW, NORMAL, HIGH, URGENT
  images: [] as ImageItem[],
});
const categoryIndex = ref(0);
const expireSel = ref(24);
const errors = ref<Record<string, string>>({});
const submitting = ref(false);

// ---- 校验 ----
function validateField(name: string): boolean {
  const e: Record<string, string> = {};
  if (name === 'title') {
    const v = form.value.title.trim();
    if (!v) e.title = '请输入标题';
    else if (v.length < 2) e.title = '标题至少 2 字';
    else if (v.length > 50) e.title = '标题最多 50 字';
  } else if (name === 'description') {
    const v = form.value.description.trim();
    if (!v) e.description = '请输入描述';
    else if (v.length < 10) e.description = '描述至少 10 字';
    else if (v.length > 500) e.description = '描述最多 500 字';
  } else if (name === 'price') {
    const n = Number(form.value.price);
    if (!form.value.price) e.price = '请输入报酬';
    else if (Number.isNaN(n) || n < 0.01) e.price = '金额至少 0.01';
    else if (n > 10000) e.price = '金额最多 10000';
    else if (!/^\d+(\.\d{1,2})?$/.test(form.value.price)) e.price = '最多两位小数';
  } else if (name === 'address') {
    if (!form.value.address) e.address = '请选择位置';
  } else if (name === 'urgency') {
    if (!form.value.urgency) e.urgency = '请选择紧急程度';
  }
  errors.value = { ...errors.value, ...e };
  if (!e[name as keyof typeof e]) {
    const next = { ...errors.value };
    delete next[name];
    errors.value = next;
  }
  return !e[name as keyof typeof e];
}

function validateAll(): boolean {
  const ok1 = validateField('title');
  const ok2 = validateField('description');
  const ok3 = validateField('price');
  const ok4 = validateField('address');
  const ok5 = validateField('urgency');
  return ok1 && ok2 && ok3 && ok4 && ok5;
}

// ---- 分类 ----
function onCategoryChange(e: { detail: { value: number } }): void {
  categoryIndex.value = e.detail.value;
}

// ---- 位置 ----
function onChooseLocation(): void {
  uni.chooseLocation({
    success: (res) => {
      console.log('chooseLocation success:', res);
      form.value.lat = res.latitude;
      form.value.lng = res.longitude;
      // name 为空时用 address 兜底
      form.value.address = res.name || res.address;
      validateField('address');
    },
    fail: (err) => {
      console.error('chooseLocation fail:', err);
      // 用户取消或未授权地图
      if (!String(err.errMsg || '').includes('cancel')) {
        uni.showToast({
          title: `获取位置失败: ${err.errMsg || '未知错误'}`,
          icon: 'none',
          duration: 3000,
        });
      }
    },
  });
}

// ---- 图片 ----
function onChooseImage(): void {
  const remain = 6 - form.value.images.length;
  if (remain <= 0) return;
  uni.chooseMedia({
    count: remain,
    mediaType: ['image'],
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      res.tempFiles.forEach((f) => uploadOne(f.tempFilePath));
    },
    fail: () => {
      // 取消选择，静默
    },
  });
}

async function uploadOne(tempPath: string): Promise<void> {
  const item: ImageItem = {
    url: tempPath,
    fileKey: '',
    uploading: true,
    progress: 0,
  };
  form.value.images.push(item);
  const idx = form.value.images.length - 1;

  try {
    const result = await uploadImage(tempPath, (p) => {
      form.value.images[idx].progress = p;
    });
    form.value.images[idx].url = result.url;
    form.value.images[idx].fileKey = result.fileKey;
    form.value.images[idx].uploading = false;
  } catch (err) {
    // 上传失败，移除占位
    form.value.images.splice(idx, 1);
    uni.showToast({ title: (err as Error).message || '图片上传失败', icon: 'none' });
  }
}

function onRemoveImage(idx: number): void {
  form.value.images.splice(idx, 1);
}

// ---- 提交 ----
async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  if (!validateAll()) {
    uni.showToast({ title: '请完善表单', icon: 'none' });
    return;
  }
  // 确保图片都上传完成
  if (form.value.images.some((i) => i.uploading)) {
    uni.showToast({ title: '图片上传中，请稍候', icon: 'none' });
    return;
  }

  submitting.value = true;
  try {
    const expireAt = new Date(Date.now() + expireSel.value * 3600 * 1000).toISOString();
    const { id: taskId } = await taskApi.create({
      title: form.value.title.trim(),
      category: categoryKeys[categoryIndex.value],
      description: form.value.description.trim(),
      price: Number(form.value.price),
      lat: form.value.lat,
      lng: form.value.lng,
      address: form.value.address,
      urgency: form.value.urgency as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT',
      images: form.value.images.map((i) => i.url),
      expireAt,
    });
    
    tracker.track(EVENTS.TASK_PUBLISH, {
      taskId,
      category: categoryKeys[categoryIndex.value],
      price: Number(form.value.price),
      userId: userStore.userInfo?.id,
    });
    
    subscribeOnTaskPublish();
    
    uni.showToast({ title: '发布成功', icon: 'success' });
    setTimeout(() => {
      uni.switchTab({ url: `/pages/index/index` });
    }, 800);
  } catch (err) {
    // 埋点：任务发布失败
    tracker.track(EVENTS.TASK_PUBLISH, {
      category: categoryKeys[categoryIndex.value],
      price: Number(form.value.price),
      userId: userStore.userInfo?.id,
      status: 'failed',
      error: (err as Error)?.message || 'unknown',
    });
    // request 拦截器已 Toast 错误
  } finally {
    submitting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.publish-page {
  min-height: 100vh;
  padding: 24rpx 24rpx 48rpx;
  background-color: #f8f8f8;
}

.form-card {
  background-color: #fff;
  border-radius: 20rpx;
  padding: 24rpx 28rpx;
  box-shadow: 0 2rpx 16rpx rgba(0, 0, 0, 0.04);
}

.field {
  padding: 24rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}

.field:last-child {
  border-bottom: none;
}

.label {
  display: flex;
  align-items: center;
  font-size: 28rpx;
  color: #333;
  font-weight: 500;
  margin-bottom: 16rpx;
  line-height: 1.4;
}

.label-text {
  font-size: 28rpx;
  color: #333;
  font-weight: 500;
}

.label .req {
  color: #e53935;
  margin-right: 6rpx;
  font-weight: 600;
  font-size: 28rpx;
}

.label .optional-tag {
  font-size: 24rpx;
  color: #999;
  font-weight: 400;
  margin-left: 4rpx;
}

.input,
.textarea {
  width: 100%;
  font-size: 32rpx;
  line-height: 48rpx;
  min-height: 88rpx;
  padding: 20rpx 24rpx;
  background-color: #f7f7f7;
  border-radius: 12rpx;
  box-sizing: border-box;
  color: #333;
}

.textarea {
  min-height: 200rpx;
  line-height: 1.7;
}

.ph {
  color: #bbb;
  font-size: 30rpx;
}

.input-err {
  background-color: #fff0f0;
  border: 1rpx solid #ffcccc;
}

.err {
  display: block;
  font-size: 24rpx;
  color: #e53935;
  margin-top: 10rpx;
}

.picker {
  font-size: 32rpx;
  padding: 20rpx 24rpx;
  min-height: 88rpx;
  line-height: 48rpx;
  background-color: #f7f7f7;
  border-radius: 12rpx;
  color: #333;
  box-sizing: border-box;
}

.row-field {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.sub-field {
  flex: 1;
}

.urgency-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.expire-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.chip {
  padding: 14rpx 28rpx;
  font-size: 28rpx;
  color: #666;
  background-color: #f0f0f0;
  border-radius: 32rpx;
  transition: all 0.2s ease;
}

.chip-active {
  background-color: #4caf50;
  color: #fff;
}

.loc-picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 32rpx;
  padding: 24rpx;
  min-height: 88rpx;
  background-color: #f7f7f7;
  border-radius: 12rpx;
  box-sizing: border-box;
  color: #333;
}

.loc-text {
  flex: 1;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.loc-arrow {
  color: #bbb;
  font-size: 36rpx;
}

.img-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 8rpx;
}

.img-item,
.img-add {
  position: relative;
  width: 200rpx;
  height: 200rpx;
  border-radius: 12rpx;
  overflow: hidden;
}

.img-item {
  background-color: #f0f0f0;
}

.img {
  width: 100%;
  height: 100%;
}

.img-mask {
  position: absolute;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.img-progress {
  color: #fff;
  font-size: 28rpx;
}

.img-del {
  position: absolute;
  top: 0;
  right: 0;
  width: 44rpx;
  height: 44rpx;
  background-color: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom-left-radius: 12rpx;
}

.img-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 2rpx dashed #ccc;
  background-color: #fafafa;
}

.img-add-icon {
  font-size: 56rpx;
  color: #ccc;
  line-height: 1;
}

.img-add-text {
  font-size: 22rpx;
  color: #999;
  margin-top: 8rpx;
}

.submit-btn {
  margin-top: 32rpx;
  width: 100%;
  height: 92rpx;
  line-height: 92rpx;
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
</style>
