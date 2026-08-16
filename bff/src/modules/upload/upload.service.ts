import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { extname, join, dirname } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import COS from 'cos-nodejs-sdk-v5';
import * as crypto from 'crypto';

export interface UploadResult {
  fileKey: string;
  url: string;
}

export interface PresignedUrlResult {
  uploadUrl: string;
  fileKey: string;
  accessUrl: string;
  expiresIn: number;
}

const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const PRESIGNED_EXPIRES = 300; // 5 分钟

export interface CosClient {
  setConfig(config: Record<string, unknown>): void;
  putObject(params: Record<string, unknown>, callback: (err: Error | null) => void): void;
  getObjectUrl(
    params: Record<string, unknown>,
    callback: (err: Error | null, data: { Url: string }) => void,
  ): void;
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private cos: CosClient | null = null;
  private cosReady = false;
  private bucket = '';
  private region = '';
  private cdnDomain = '';

  constructor() {
    const secretId = process.env.COS_SECRET_ID || '';
    const secretKey = process.env.COS_SECRET_KEY || '';
    this.bucket = process.env.COS_BUCKET || 'neighborhood-help-1250000000';
    this.region = process.env.COS_REGION || 'ap-guangzhou';
    this.cdnDomain = process.env.COS_CDN_DOMAIN || '';
    if (secretId && secretKey) {
      try {
        this.cos = new COS({ SecretId: secretId, SecretKey: secretKey }) as unknown as CosClient;
        this.cos.setConfig({ Region: this.region });
        this.cosReady = true;
        this.logger.log('COS 已配置，图片将上传至腾讯云 COS');
      } catch (e) {
        this.logger.warn(`COS 初始化失败，降级为本地存储: ${(e as Error).message}`);
      }
    } else {
      this.logger.warn('COS_SECRET_ID/KEY 未配置，图片将存储到本地 uploads/ 目录');
    }
  }

  /**
   * 生成预签名上传 URL（前端直传 COS，不走 BFF 流量）
   * 5 分钟内有效，上传后自动获得访问 URL
   */
  async getPresignedUploadUrl(fileName: string, _fileType: string): Promise<PresignedUrlResult> {
    if (!this.cosReady) {
      throw new BadRequestException('COS 未配置，请使用普通上传接口');
    }

    const ext = extname(fileName).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      throw new BadRequestException('仅支持 jpg/png/webp/gif 图片');
    }

    // 生成唯一 fileKey
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const rand = crypto.randomBytes(8).toString('hex');
    const fileKey = `tasks/${yyyy}/${mm}/${rand}${ext}`;

    return new Promise<PresignedUrlResult>((resolve, reject) => {
      this.cos!.getObjectUrl(
        {
          Bucket: this.bucket,
          Key: fileKey,
          Sign: true,
          Expires: PRESIGNED_EXPIRES,
          Query: {},
        },
        (err: Error | null, data: { Url: string }) => {
          if (err) {
            this.logger.error(`生成预签名 URL 失败: ${err.message}`);
            reject(new BadRequestException('生成上传链接失败'));
          } else {
            const accessUrl = this.cdnDomain
              ? `${this.cdnDomain}/${fileKey}`
              : `https://${this.bucket}.cos.${this.region}.myqcloud.com/${fileKey}`;
            resolve({
              uploadUrl: data.Url,
              fileKey,
              accessUrl,
              expiresIn: PRESIGNED_EXPIRES,
            });
          }
        },
      );
    });
  }

  /**
   * 传统上传：通过 BFF 中转（兼容无 COS 环境）
   */
  async uploadImage(file: Express.Multer.File): Promise<UploadResult> {
    if (!file) throw new BadRequestException('未接收到文件');
    if (!ALLOWED_EXT.includes(extname(file.originalname).toLowerCase())) {
      throw new BadRequestException('仅支持 jpg/png/webp/gif 图片');
    }
    if (file.size > MAX_SIZE) {
      throw new BadRequestException('图片大小不能超过 5MB');
    }

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const rand = crypto.randomBytes(8).toString('hex');
    const fileKey = `tasks/${yyyy}/${mm}/${rand}${extname(file.originalname)}`;

    if (this.cosReady) {
      return this.uploadToCos(file, fileKey);
    }
    return this.saveLocal(file, fileKey);
  }

  private async uploadToCos(file: Express.Multer.File, fileKey: string): Promise<UploadResult> {
    return new Promise<UploadResult>((resolve, reject) => {
      this.cos!.putObject(
        {
          Bucket: this.bucket,
          Key: fileKey,
          Body: file.buffer,
        },
        (err: Error | null) => {
          if (err) {
            this.logger.warn(`COS 上传失败，回退本地: ${err.message}`);
            this.saveLocal(file, fileKey).then(resolve).catch(reject);
          } else {
            const url = this.cdnDomain
              ? `${this.cdnDomain}/${fileKey}`
              : `https://${this.bucket}.cos.${this.region}.myqcloud.com/${fileKey}`;
            resolve({ fileKey, url });
          }
        },
      );
    });
  }

  private async saveLocal(file: Express.Multer.File, fileKey: string): Promise<UploadResult> {
    const dir = join(process.cwd(), 'uploads', dirname(fileKey));
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const absPath = join(process.cwd(), 'uploads', fileKey);
    await writeFile(absPath, file.buffer);
    const url = `/uploads/${fileKey}`;
    return { fileKey, url };
  }
}
