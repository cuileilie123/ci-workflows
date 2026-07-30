---
name: file-upload-cos
description: 实现文件上传到腾讯云COS（预签名URL+安全检测）
model: claude-4-sonnet
tags: [bff, storage]
depends_on: [nestjs-init, wx-login-gateway]
---

# 任务：实现文件上传服务（COS）

## 目标
提供安全的文件上传通道（预签名 URL + 图片压缩 + 安全检测）。

## 具体步骤

### 1. 腾讯云 COS 配置 `config/cos.config.ts`
```typescript
export const cosConfig = {
  secretId: process.env.COS_SECRET_ID,
  secretKey: process.env.COS_SECRET_KEY,
  bucket: process.env.COS_BUCKET,   // nh-1250000000
  region: process.env.COS_REGION || 'ap-guangzhou',
  cdnDomain: process.env.COS_CDN_DOMAIN, // 可选 CDN 加速域名
  
  // 上传限制
  maxFileSize: 10 * 1024 * 1024,  // 10MB
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  
  // 目录结构
  paths: {
    task: 'tasks/{userId}/{date}/{uuid}.{ext}',
    avatar: 'avatars/{userId}/{uuid}.{ext}',
    chat: 'chat/{userId}/{date}/{uuid}.{ext}',
    review: 'reviews/{userId}/{date}/{uuid}.{ext}'
  }
};
```

### 2. 预签名 URL 服务 `modules/upload/upload.service.ts`
```typescript
@Injectable()
export class UploadService {
  private cos: COS;
  
  constructor(private config: ConfigService) {
    this.cos = new COS({
      SecretId: config.get('COS_SECRET_ID'),
      SecretKey: config.get('COS_SECRET_KEY'),
    });
  }
  
  // 生成预签名上传 URL（前端直传）
  async getPresignedUrl(
    userId: number,
    fileType: 'task' | 'avatar' | 'chat' | 'review',
    contentType: string,
    fileSize: number
  ): Promise<PresignResult> {
    // 1. 校验文件类型
    if (!cosConfig.allowedTypes.includes(contentType)) {
      throw new BadRequestException(`不支持的文件类型: ${contentType}`);
    }
    
    // 2. 校验文件大小
    if (fileSize > cosConfig.maxFileSize) {
      throw new BadRequestException(`文件过大: ${fileSize} > ${cosConfig.maxFileSize}`);
    }
    
    // 3. 生成唯一 Key
    const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const uuid = randomUUID();
    const key = cosConfig.paths[fileType]
      .replace('{userId}', String(userId))
      .replace('{date}', date)
      .replace('{uuid}', uuid)
      .replace('{ext}', ext);
    
    // 4. 生成预签名 URL（有效期 5 分钟）
    const url = await this.cos.getAuthorization({
      Method: 'PUT',
      Key: key,
      Expires: 300,
      Headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileSize)
      }
    });
    
    return {
      uploadUrl: url,
      fileKey: key,
      cdnUrl: `${cosConfig.cdnDomain || `https://${cosConfig.bucket}.cos.${cosConfig.region}.myqcloud.com`}/${key}`,
      expiresIn: 300
    };
  }
  
  // 确认上传完成（异步安全检测）
  async confirmUpload(fileKey: string, contentType: string) {
    // 1. 异步图片安全检测（微信 imgSecCheck）
    if (contentType.startsWith('image/')) {
      const imageBuffer = await this.cos.getObject({
        Bucket: cosConfig.bucket,
        Region: cosConfig.region,
        Key: fileKey
      });
      
      try {
        await this.wxService.imgSecCheck(imageBuffer.Body);
      } catch (err) {
        // 违规图片 → 删除
        await this.cos.deleteObject({
          Bucket: cosConfig.bucket,
          Region: cosConfig.region,
          Key: fileKey
        });
        throw new ForbiddenException('图片内容违规，已删除');
      }
    }
    
    return { status: 'ok', fileKey };
  }
}
```

### 3. 上传控制器 `modules/upload/upload.controller.ts`
```typescript
@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  
  @Post('presign')
  async getPresign(@Body() dto: PresignDto, @Req() req) {
    return this.uploadService.getPresignedUrl(
      req.user.sub,
      dto.type,
      dto.contentType,
      dto.fileSize
    );
  }
  
  @Post('confirm')
  async confirm(@Body() dto: ConfirmUploadDto) {
    return this.uploadService.confirmUpload(dto.fileKey, dto.contentType);
  }
  
  // 批量获取预签名 URL
  @Post('batch-presign')
  async batchPresign(@Body() dto: BatchPresignDto, @Req() req) {
    const results = await Promise.all(
      dto.files.map(f => 
        this.uploadService.getPresignedUrl(req.user.sub, dto.type, f.contentType, f.fileSize)
      )
    );
    return { urls: results };
  }
}
```

### 4. 前端上传工具 `utils/upload.ts`
```typescript
interface UploadResult {
  fileKey: string;
  cdnUrl: string;
}

// 上传单张图片
export async function uploadImage(
  filePath: string,
  type: 'task' | 'avatar' | 'chat' | 'review',
  onProgress?: (percent: number) => void
): Promise<UploadResult> {
  // 1. 获取文件信息
  const fs = wx.getFileSystemManager();
  const stat = fs.statSync(filePath);
  
  // 2. 获取预签名 URL
  const { data: presign } = await request.post('/api/v1/upload/presign', {
    type,
    contentType: 'image/jpeg',
    fileSize: stat.size
  });
  
  // 3. 直传 COS
  return new Promise((resolve, reject) => {
    const uploadTask = wx.uploadFile({
      url: presign.uploadUrl,
      filePath,
      name: 'file',
      header: {
        'Content-Type': 'image/jpeg'
      },
      success: async () => {
        // 4. 确认上传
        await request.post('/api/v1/upload/confirm', {
          fileKey: presign.fileKey,
          contentType: 'image/jpeg'
        });
        resolve({ fileKey: presign.fileKey, cdnUrl: presign.cdnUrl });
      },
      fail: reject
    });
    
    uploadTask.onProgressUpdate((res) => {
      onProgress?.(res.progress);
    });
  });
}

// 批量上传
export async function batchUpload(
  filePaths: string[],
  type: 'task' | 'avatar' | 'chat' | 'review'
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (const path of filePaths) {
    const result = await uploadImage(path, type);
    results.push(result);
  }
  return results;
}
```

### 5. 图片压缩工具 `utils/image.ts`
```typescript
// 压缩图片到目标尺寸
export function compressImage(
  filePath: string,
  maxWidth = 1280,
  quality = 80
): Promise<string> {
  return new Promise((resolve) => {
    wx.compressImage({
      src: filePath,
      quality,
      success: (res) => {
        // 进一步裁剪到 maxWidth
        const info = wx.getImageInfoSync({ src: res.tempFilePath });
        if (info.width > maxWidth) {
          const scale = maxWidth / info.width;
          wx.canvasToTempFilePath({
            canvasId: 'compressCanvas',
            width: maxWidth,
            height: info.height * scale,
            destWidth: maxWidth,
            destHeight: info.height * scale,
            fileType: 'jpg',
            quality: quality / 100,
            success: (r) => resolve(r.tempFilePath),
            fail: () => resolve(res.tempFilePath)
          });
        } else {
          resolve(res.tempFilePath);
        }
      },
      fail: () => resolve(filePath) // 压缩失败用原图
    });
  });
}
```

### 6. 对应需求条目
#15, #17, #23, #39, #50

## 验收标准
- [ ] 预签名 URL 5 分钟内有效
- [ ] 前端直传 COS（不走 BFF 流量）
- [ ] 文件类型校验生效
- [ ] 文件大小限制生效
- [ ] 违规图片自动删除
- [ ] 上传进度回调正常
- [ ] 图片压缩生效（>1280px 缩小）
- [ ] CDN 加速域名可访问

## 参考文件
- `specs/02-task.md` → 图片上传
- `.trae/memory.md` → 已知坑（uploadFile 不支持 PUT）
