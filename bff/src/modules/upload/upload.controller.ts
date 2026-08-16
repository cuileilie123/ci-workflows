import {
  Controller,
  Post,
  Get,
  UseInterceptors,
  UseGuards,
  UploadedFile,
  Req,
  HttpCode,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UploadService } from './upload.service';

@ApiTags('上传')
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @ApiOperation({ summary: '获取预签名上传 URL（前端直传 COS）' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('presigned')
  async getPresignedUrl(@Query('fileName') fileName: string, @Query('fileType') fileType: string) {
    if (!fileName) {
      throw new BadRequestException('缺少 fileName 参数');
    }
    return this.uploadService.getPresignedUploadUrl(fileName, fileType || 'image/jpeg');
  }

  @ApiOperation({ summary: '上传图片（COS 或本地降级）' })
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  @Post()
  @HttpCode(200)
  upload(@UploadedFile() file: Express.Multer.File, @Req() _req: Request) {
    return this.uploadService.uploadImage(file);
  }
}
