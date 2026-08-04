import type { UploadResult, ApiResponse } from '@/types';
import { getAccessToken } from '@/utils/request';

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

/**
 * 上传图片到 BFF（BFF 再转存 COS 或本地）。
 * 使用 uni.uploadFile（multipart/form-data），返回图片访问 URL。
 */
export function uploadImage(
  filePath: string,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  const token = getAccessToken();

  return new Promise<UploadResult>((resolve, reject) => {
    const task = uni.uploadFile({
      url: `${BASE_URL}/upload`,
      filePath,
      name: 'file',
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success: (res) => {
        try {
          const body = JSON.parse(res.data) as ApiResponse<UploadResult>;
          if (body.code === 0 && body.data) {
            // 本地降级返回相对 URL，补全为完整地址
            const url = body.data.url.startsWith('http')
              ? body.data.url
              : `${BASE_URL.replace(/\/api\/v1$/, '')}${body.data.url}`;
            resolve({ fileKey: body.data.fileKey, url });
          } else {
            reject(new Error(body.message || '上传失败'));
          }
        } catch {
          reject(new Error('上传响应解析失败'));
        }
      },
      fail: (err) => reject(new Error(err.errMsg || '上传失败')),
    });

    if (onProgress && task && task.onProgressUpdate) {
      task.onProgressUpdate((p) => onProgress(p.progress));
    }
  });
}
