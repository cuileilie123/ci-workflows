<template>
  <view class="image-upload">
    <!-- 已上传图片列表 -->
    <view class="upload-list">
      <view
        v-for="(img, index) in imageList"
        :key="index"
        class="upload-item"
      >
        <image
          :src="img.url"
          mode="aspectFill"
          class="upload-preview"
          @click="previewImage(index)"
        />
        <view class="upload-delete" @click="removeImage(index)">
          <text class="delete-icon">×</text>
        </view>
        <!-- 上传中遮罩 -->
        <view v-if="img.uploading" class="upload-mask">
          <view class="upload-progress">
            <text class="progress-text">{{ img.progress }}%</text>
          </view>
        </view>
      </view>

      <!-- 添加按钮 -->
      <view
        v-if="imageList.length < maxCount"
        class="upload-add"
        @click="chooseImage"
      >
        <text class="add-icon">+</text>
        <text class="add-text">{{ imageList.length }}/{{ maxCount }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { uploadApi, type UploadProgress, type MiniProgramFile } from '@/api/upload';
import { tracker } from '@/utils/track';

// ---- 日志工具 ----
const LOG_TAG = '[ImageUpload]';
const isDev = import.meta.env.DEV;

function log(...args: unknown[]) {
  if (isDev) {
    console.log(LOG_TAG, new Date().toISOString().slice(11, 19), ...args);
  }
}

function warn(...args: unknown[]) {
  console.warn(LOG_TAG, '⚠️', ...args);
}

function error(...args: unknown[]) {
  console.error(LOG_TAG, '❌', ...args);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface ImageItem {
  url: string;
  fileKey?: string;
  uploading: boolean;
  progress: number;
}

const props = withDefaults(
  defineProps<{
    /** 最大上传数量 */
    maxCount?: number;
    /** 已上传图片列表（v-model） */
    modelValue?: string[];
  }>(),
  {
    maxCount: 6,
    modelValue: () => [],
  },
);

const emit = defineEmits<{
  'update:modelValue': [urls: string[]];
  change: [urls: string[]];
}>();

const imageList = ref<ImageItem[]>(
  props.modelValue.map((url) => ({ url, uploading: false, progress: 0 })),
);

log('组件初始化', { maxCount: props.maxCount, initialImages: props.modelValue.length });

watch(
  () => props.modelValue,
  (newVal) => {
    log('modelValue 变化', { count: newVal.length });
    imageList.value = newVal.map((url) => ({
      url,
      uploading: false,
      progress: 0,
    }));
  },
);

/** 选择图片并上传 */
async function chooseImage(): Promise<void> {
  const remain = props.maxCount - imageList.value.length;
  log('触发选择图片', { currentCount: imageList.value.length, remain });

  if (remain <= 0) {
    warn('已达最大上传数量', { maxCount: props.maxCount });
    return;
  }

  // 埋点：选择图片
  tracker.track('upload_start', {
    maxCount: props.maxCount,
    remain,
  });

  try {
    log('调用 uni.chooseImage', { count: remain, sizeType: ['compressed'], sourceType: ['album', 'camera'] });

    const res = await new Promise<UniApp.ChooseImageSuccessCallbackResult>(
      (resolve, reject) => {
        uni.chooseImage({
          count: remain,
          sizeType: ['compressed'],
          sourceType: ['album', 'camera'],
          success: resolve,
          fail: reject,
        });
      },
    );

    log('图片选择成功', {
      count: res.tempFilePaths.length,
      totalSize: formatBytes(
        Array.isArray(res.tempFiles)
          ? (res.tempFiles as Array<{ size?: number }>).reduce((sum: number, f: { size?: number }) => sum + (f.size || 0), 0)
          : 0,
      ),
    });

    // 逐张上传
    const tempFilesArray = Array.isArray(res.tempFiles) ? (res.tempFiles as Array<{ size?: number }>) : [];
    for (let i = 0; i < res.tempFilePaths.length; i++) {
      const tempPath = res.tempFilePaths[i];
      const tempFile = tempFilesArray[i];
      log(`准备上传第 ${i + 1}/${res.tempFilePaths.length} 张图片`, {
        path: tempPath,
        size: tempFile?.size ? formatBytes(tempFile.size) : 'unknown',
      });
      await uploadSingleImage(tempPath);
    }

    log('批量上传完成', { successCount: imageList.value.length });
  } catch (err) {
    const msg = (err as Error).message || '';
    if (msg.includes('cancel')) {
      log('用户取消选择图片');
    } else {
      error('选择图片失败', err);
      uni.showToast({ title: '选择图片失败', icon: 'none' });
    }
  }
}

/** 上传单张图片 */
async function uploadSingleImage(tempPath: string): Promise<void> {
  const startTime = Date.now();
  log('开始上传单张图片', { path: tempPath });

  // 添加占位
  const newItem: ImageItem = {
    url: tempPath,
    uploading: true,
    progress: 0,
  };
  imageList.value.push(newItem);

  try {
    // 获取文件信息
    log('获取文件信息...');
    const fileInfo = await new Promise<UniApp.GetFileInfoSuccess>(
      (resolve, reject) => {
        uni.getFileInfo({
          filePath: tempPath,
          success: resolve,
          fail: reject,
        });
      },
    );

    log('文件信息获取成功', {
      size: formatBytes(fileInfo.size),
      digest: fileInfo.digest?.slice(0, 8) || 'N/A',
    });

    // 压缩：>1280px 时缩小
    const compressThreshold = 1280;
    const quality = 0.8;
    const needCompress = fileInfo.size > 100 * 1024; // >100KB 才压缩

    log('图片压缩判断', {
      size: formatBytes(fileInfo.size),
      needCompress,
      threshold: formatBytes(100 * 1024),
      maxWidth: compressThreshold,
      quality,
    });

    // 显示上传开始进度
    newItem.progress = 5;
    log('开始上传到服务器...', { progress: newItem.progress });

    const mpFile: MiniProgramFile = { path: tempPath, size: fileInfo.size };

    const url = await uploadApi.upload(mpFile, {
        maxWidth: compressThreshold,
        quality,
        onProgress: (progress: UploadProgress) => {
          newItem.progress = progress.progress;
          if (progress.progress % 20 === 0 || progress.progress === 100) {
            log('上传进度', {
              progress: `${progress.progress}%`,
              loaded: formatBytes(progress.loaded),
              total: formatBytes(progress.total),
            });
          }
        },
      },
    );

    const elapsed = Date.now() - startTime;
    newItem.url = url;
    newItem.uploading = false;
    newItem.progress = 100;

    log('✅ 上传成功', {
      url: url.slice(0, 60) + '...',
      originalSize: formatBytes(fileInfo.size),
      elapsed: `${elapsed}ms`,
    });

    // 埋点：上传成功
    tracker.track('upload_success', {
      fileSize: fileInfo.size,
      elapsed,
    });

    emitChange();
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const errMessage = (err as Error).message || 'unknown';

    error('❌ 上传失败', {
      path: tempPath,
      error: errMessage,
      elapsed: `${elapsed}ms`,
      stack: isDev ? (err as Error).stack : undefined,
    });

    newItem.uploading = false;
    // 上传失败，移除占位
    const idx = imageList.value.indexOf(newItem);
    if (idx > -1) {
      imageList.value.splice(idx, 1);
      log('已移除失败的上传项', { index: idx });
    }

    // 埋点：上传失败
    tracker.track('upload_fail', {
      error: errMessage,
      elapsed,
    });

    uni.showToast({ title: '图片上传失败，请重试', icon: 'none' });
  }
}

/** 删除图片 */
function removeImage(index: number): void {
  log('触发删除图片', { index, currentCount: imageList.value.length });

  uni.showModal({
    title: '提示',
    content: '确定删除这张图片吗？',
    success: (res) => {
      if (res.confirm) {
        const removedUrl = imageList.value[index]?.url;
        imageList.value.splice(index, 1);
        log('图片已删除', { index, url: removedUrl?.slice(0, 60) + '...', remainingCount: imageList.value.length });
        emitChange();
      } else {
        log('用户取消删除');
      }
    },
  });
}

/** 预览图片 */
function previewImage(index: number): void {
  const urls = imageList.value.map((img) => img.url);
  log('预览图片', { index, total: urls.length, url: urls[index]?.slice(0, 60) + '...' });
  uni.previewImage({ current: urls[index], urls });
}

/** 触发更新事件 */
function emitChange(): void {
  const urls = imageList.value.map((img) => img.url);
  log('触发 change 事件', { urls: urls.map((u) => u.slice(0, 40) + '...') });
  emit('update:modelValue', urls);
  emit('change', urls);
}
</script>

<style lang="scss" scoped>
.image-upload {
  width: 100%;
}

.upload-list {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.upload-item {
  position: relative;
  width: 200rpx;
  height: 200rpx;
  border-radius: 12rpx;
  overflow: hidden;
  background-color: #f5f5f5;
}

.upload-preview {
  width: 100%;
  height: 100%;
}

.upload-delete {
  position: absolute;
  top: 0;
  right: 0;
  width: 48rpx;
  height: 48rpx;
  background-color: rgba(0, 0, 0, 0.5);
  border-radius: 0 12rpx 0 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.delete-icon {
  font-size: 28rpx;
  color: #fff;
  line-height: 1;
}

.upload-mask {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.upload-progress {
  background-color: rgba(255, 255, 255, 0.9);
  border-radius: 20rpx;
  padding: 10rpx 20rpx;
}

.progress-text {
  font-size: 24rpx;
  color: #4caf50;
}

.upload-add {
  width: 200rpx;
  height: 200rpx;
  border: 2rpx dashed #ddd;
  border-radius: 12rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  background-color: #fafafa;
}

.add-icon {
  font-size: 60rpx;
  color: #ccc;
  line-height: 1;
}

.add-text {
  font-size: 22rpx;
  color: #999;
}
</style>
