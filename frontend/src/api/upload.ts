import { request } from '@/utils/request';

/** 预签名上传 URL 响应 */
export interface PresignedUploadResult {
  uploadUrl: string;
  fileKey: string;
  accessUrl: string;
  expiresIn: number;
}

/** 上传结果（BFF 中转模式） */
export interface UploadResult {
  fileKey: string;
  url: string;
}

/** 上传进度回调 */
export interface UploadProgress {
  progress: number; // 0-100
  loaded: number;
  total: number;
}

/** 上传配置 */
export interface UploadOptions {
  /** 图片压缩：最大宽度（默认 1280） */
  maxWidth?: number;
  /** 图片压缩：质量（0-1，默认 0.8） */
  quality?: number;
  /** 进度回调 */
  onProgress?: (progress: UploadProgress) => void;
}

/** 小程序文件对象 */
export interface MiniProgramFile {
  path: string;
  size: number;
  name?: string;
}

export const uploadApi = {
  /**
   * 获取预签名上传 URL（用于前端直传 COS）
   */
  getPresignedUrl(fileName: string, fileType?: string): Promise<PresignedUploadResult> {
    return request<PresignedUploadResult>({
      url: `/upload/presigned?fileName=${encodeURIComponent(fileName)}&fileType=${fileType || 'image/jpeg'}`,
    });
  },

  /**
   * 完整上传流程：获取预签名 URL → 直传 COS
   * 小程序环境使用 uni.uploadFile，H5 环境可直传
   */
  async upload(file: MiniProgramFile, options?: UploadOptions): Promise<string> {
    // 1. 获取预签名 URL
    const ext = getFileExtension(file.name || file.path);
    const fileName = `image${ext}`;
    const presigned = await uploadApi.getPresignedUrl(fileName, getMimeType(ext));

    // 2. 直传 COS（使用 uni.uploadFile）
    await uploadToCos(presigned.uploadUrl, file.path, options?.onProgress);

    return presigned.accessUrl;
  },

  /**
   * BFF 中转上传（降级方案，COS 未配置时使用）
   */
  uploadViaBff(file: MiniProgramFile, onProgress?: (progress: UploadProgress) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const BASE_URL = import.meta.env.VITE_API_BASE_URL;
      const token = uni.getStorageSync('nh_access_token') as string;

      const uploadTask = uni.uploadFile({
        url: `${BASE_URL}/upload`,
        filePath: file.path,
        name: 'file',
        header: {
          Authorization: `Bearer ${token}`,
        },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              // 安全地解析响应数据
              const parsed = JSON.parse(res.data);
              
              // 验证响应结构
              if (typeof parsed === 'object' && parsed !== null) {
                const data = parsed as { code: number; data: { url: string }; message: string };
                
                // 验证必需字段
                if (typeof data.code !== 'number' || !data.data || typeof data.data.url !== 'string') {
                  reject(new Error('上传响应格式错误'));
                  return;
                }
                
                if (data.code === 0) {
                  resolve(data.data.url as string);
                } else {
                  reject(new Error(data.message || '上传失败'));
                }
              } else {
                reject(new Error('上传响应格式错误'));
              }
            } catch (parseError) {
              console.error('解析上传响应失败:', parseError);
              reject(new Error('上传响应解析失败'));
            }
          } else {
            reject(new Error(`上传失败: ${res.statusCode}`));
          }
        },
        fail: (err) => reject(new Error(err.errMsg || '上传网络错误')),
      });

      // 监听上传进度
      if (onProgress) {
        uploadTask.onProgressUpdate((progressRes) => {
          onProgress({
            progress: progressRes.progress,
            loaded: progressRes.totalBytesSent,
            total: progressRes.totalBytesExpectedToSend,
          });
        });
      }
    });
  },
};

/**
 * 直传 COS（使用 uni.uploadFile PUT 方法）
 */
function uploadToCos(
  uploadUrl: string,
  filePath: string,
  onProgress?: (progress: UploadProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const uploadTask = uni.uploadFile({
      url: uploadUrl,
      filePath,
      name: 'file',
      method: 'PUT',
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`COS 上传失败: ${res.statusCode}`));
        }
      },
      fail: (err) => reject(new Error(err.errMsg || 'COS 上传网络错误')),
    });

    // 监听上传进度
    if (onProgress) {
      uploadTask.onProgressUpdate((progressRes) => {
        onProgress({
          progress: progressRes.progress,
          loaded: progressRes.totalBytesSent,
          total: progressRes.totalBytesExpectedToSend,
        });
      });
    }
  });
}

/** 从路径或文件名获取扩展名 */
function getFileExtension(path: string): string {
  const match = path.match(/\.[^.]+$/);
  return match ? match[0] : '.jpg';
}

/** 扩展名 → MIME 类型 */
function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  return map[ext.toLowerCase()] || 'image/jpeg';
}

/**
 * 便捷上传函数（供页面直接使用）
 * @param filePath 图片本地路径
 * @param onProgress 进度回调
 * @returns 上传结果 { url, fileKey }
 */
export async function uploadImage(
  filePath: string,
  onProgress?: (progress: number) => void,
): Promise<{ url: string; fileKey: string }> {
  // 优先使用预签名 URL 直传，失败时降级到 BFF 中转
  try {
    const url = await uploadApi.upload(
      { path: filePath, size: 0 },
      {
        onProgress: onProgress
          ? (p) => onProgress(p.progress)
          : undefined,
      },
    );
    return { url, fileKey: url.split('/').pop() || '' };
  } catch {
    // 降级到 BFF 中转
    const url = await uploadApi.uploadViaBff(
      { path: filePath, size: 0 },
      onProgress ? (p) => onProgress(p.progress) : undefined,
    );
    return { url, fileKey: url.split('/').pop() || '' };
  }
}
