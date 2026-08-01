import {
  Controller,
  Get,
  Delete,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { Response, Request } from 'express';
import * as crypto from 'crypto';
// @ts-ignore - cos-nodejs-sdk-v5 has no types
import COS from 'cos-nodejs-sdk-v5';

@Controller('users')
export class GdprController {
  private cos: any = null;

  constructor(private readonly prisma: PrismaService) {}

  private getCos(): any | null {
    if (!this.cos) {
      const secretId = process.env.COS_SECRET_ID || '';
      const secretKey = process.env.COS_SECRET_KEY || '';
      const region = process.env.COS_REGION || 'ap-guangzhou';
      if (secretId && secretKey) {
        try {
          this.cos = new COS({
            SecretId: secretId,
            SecretKey: secretKey,
          });
          this.cos.setConfig({ Region: region });
        } catch {
          return null;
        }
      }
    }
    return this.cos;
  }

  private encrypt(data: string): string {
    const key = crypto
      .createHash('sha256')
      .update(process.env.JWT_SECRET || 'default-secret')
      .digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return `${iv.toString('hex')}:${encrypted}`;
  }

  @Get('data-export')
  @UseGuards(JwtAuthGuard)
  async exportUserData(@Req() req: Request, @Res() res: Response) {
    const userId = BigInt((req as any).user.sub);

    const [user, tasks, orders, reviews, transactions, tickets] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.task.findMany({ where: { publisherId: userId } }),
      this.prisma.order.findMany({ where: { helperId: userId } }),
      this.prisma.review.findMany({
        where: { OR: [{ reviewerId: userId }, { revieweeId: userId }] },
      }),
      this.prisma.transaction.findMany({
        where: { wallet: { userId } },
      }),
      this.prisma.ticket.findMany({ where: { userId } }),
    ]);

    const exportData = {
      exportDate: new Date().toISOString(),
      user: user
        ? {
            ...user,
            password: undefined,
            openid: undefined,
            deviceFp: undefined,
          }
        : null,
      tasks,
      orders,
      reviews,
      transactions,
      tickets,
    };

    const encrypted = this.encrypt(JSON.stringify(exportData));

    const cos = this.getCos();
    const cosKey = `gdpr-exports/${userId}/${Date.now()}.json`;

    if (cos) {
      try {
        const bucket = process.env.COS_BUCKET || 'neighborhood-help-1250000000';

        await new Promise<void>((resolve, reject) => {
          cos.putObject(
            {
              Bucket: bucket,
              Key: cosKey,
              Body: encrypted,
              Expires: '3600',
            },
            (err: Error | null) => {
              if (err) reject(err);
              else resolve();
            },
          );
        });

        const url = await new Promise<string>((resolve, reject) => {
          cos.getObjectUrl(
            {
              Bucket: bucket,
              Key: cosKey,
              Sign: true,
              Expires: 3600,
            },
            (err: Error | null, signedUrl: string) => {
              if (err) reject(err);
              else resolve(signedUrl);
            },
          );
        });

        return res.json({ downloadUrl: url, expiresIn: 3600 });
      } catch {
        // COS 上传失败，回退到直接返回
      }
    }

    return res.json({
      data: encrypted,
      message: '加密数据已生成，请妥善保管',
    });
  }

  @Delete('account')
  @UseGuards(JwtAuthGuard)
  async deleteAccount(@Req() req: Request) {
    const userId = BigInt((req as any).user.sub);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          phone: null,
          nickname: '已注销用户',
          avatar: null,
          deviceFp: null,
          status: 'BANNED' as const,
          deletedAt: new Date(),
        },
      });

      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (wallet) {
        await tx.wallet.update({
          where: { userId },
          data: { balance: 0, frozen: 0 },
        });
      }
    });

    return { message: '账号已注销，数据已匿名化' };
  }
}
