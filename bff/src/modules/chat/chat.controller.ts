import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Req,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ChatService } from './chat.service';
import { UploadService } from '../upload/upload.service';
import { SendMessageDto } from './dto/send-message.dto';

@ApiTags('聊天')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly uploadService: UploadService,
  ) {}

  /** 从 JWT payload 取用户 ID */
  private userId(req: Request): string {
    return (req as unknown as { user: { sub: string } }).user.sub;
  }

  @ApiOperation({ summary: '发送消息（REST API）' })
  @Post('messages')
  async sendMessage(@Body() dto: SendMessageDto, @Req() req: Request) {
    const senderId = this.userId(req);
    const conversationId = ChatService.buildConversationId(senderId, dto.receiverId);
    const message = await this.chatService.createMessage({
      conversationId,
      senderId,
      receiverId: dto.receiverId,
      type: dto.type,
      content: dto.content,
      metadata: dto.metadata ?? null,
      clientMessageId: dto.clientMessageId,
    });
    return message;
  }

  @ApiOperation({ summary: '会话列表（含最后一条消息 + 未读数）' })
  @Get('conversations')
  async getConversations(@Req() req: Request) {
    return this.chatService.getConversations(this.userId(req));
  }

  @ApiOperation({ summary: '消息历史（游标分页）' })
  @ApiQuery({ name: 'before', required: false, description: '游标（ISO 日期）' })
  @ApiQuery({ name: 'limit', required: false, description: '条数，默认 20' })
  @Get('messages/:convId')
  async getMessages(
    @Param('convId') convId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? parseInt(limit, 10) : 20;
    if (Number.isNaN(n) || n < 1 || n > 50) {
      throw new BadRequestException('limit 须为 1-50');
    }
    return this.chatService.getMessages(convId, before, n);
  }

  @ApiOperation({ summary: '上传聊天图片' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @Post('upload')
  @HttpCode(200)
  async upload(@UploadedFile() file: Express.Multer.File) {
    return this.uploadService.uploadImage(file);
  }

  @ApiOperation({ summary: '查找在线客服（第一个 ADMIN 或 STAFF）' })
  @Get('customer-service')
  async getCustomerService() {
    const cs = await this.chatService.findCustomerService();
    if (!cs) {
      return null;
    }
    return {
      userId: cs.userId,
      nickname: cs.nickname || '在线客服',
      avatar: cs.avatar,
    };
  }

  @ApiOperation({ summary: '标记会话已读' })
  @Put('read/:convId')
  async markRead(@Param('convId') convId: string, @Req() req: Request) {
    const modified = await this.chatService.markConversationRead(convId, this.userId(req));
    return { modified };
  }
}
