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

const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export interface CosClient {
  setConfig(config: Record<string, unknown>): void;
  putObject(params: Record<string, unknown>, callback: (err: Error | null) => void): void;
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private cos: CosClient | null = null;
  private cosReady = false;

  constructor() {
    const secretId = process.env.COS_SECRET_ID || '';
    const secretKey = process.env.COS_SECRET_KEY || '';
    if (secretId && secretKey) {
      try {
        this.cos = new COS({ SecretId: secretId, SecretKey: secretKey }) as unknown as CosClient;
        this.cos.setConfig({ Region: process.env.COS_REGION || 'ap-guangzhou' });
        this.cosReady = true;
        this.logger.log('COS 已配置，图片将上传至腾讯云 COS');
      } catch (e) {
        this.logger.warn(`COS 初始化失败，降级为本地存储: ${(e as Error).message}`);
      }
    } else {
      this.logger.warn('COS_SECRET_ID/KEY 未配置，图片将存储到本地 uploads/ 目录');
    }
  }

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
    const bucket = process.env.COS_BUCKET || 'neighborhood-help-1250000000';
    return new Promise<UploadResult>((resolve, reject) => {
      this.cos!.putObject(
        {
          Bucket: bucket,
          Key: fileKey,
          Body: file.buffer,
        },
        (err: Error | null) => {
          if (err) {
            this.logger.warn(`COS 上传失败，回退本地: ${err.message}`);
            this.saveLocal(file, fileKey).then(resolve).catch(reject);
          } else {
            const url = `https://${bucket}.cos.${process.env.COS_REGION || 'ap-guangzhou'}.myqcloud.com/${fileKey}`;
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
    // 相对 URL，由静态资源中间件提供访问；前端拼接 BASE_URL
    const url = `/uploads/${fileKey}`;
    return { fileKey, url };
  }
}
