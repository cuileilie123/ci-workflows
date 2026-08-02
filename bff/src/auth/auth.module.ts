import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UserModule } from '../modules/user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { WxService } from './wx.service';
import { SensitiveService } from './sensitive.service';

@Module({
  imports: [
    // Access Token 默认 2h；Refresh Token 在 AuthService 中按调用单独签发（独立密钥 + 7d）
    // global: true 让 JwtAuthGuard 在任意模块可用（UserModule 的 GdprController 等需鉴权）
    JwtModule.register({
      global: true,
      secret:
        process.env.JWT_SECRET ||
        'nh_dev_jwt_secret_2026_change_in_production',
      signOptions: { expiresIn: '2h' },
    }),
    // UserModule 导出 PrismaService，供 AuthService 注入
    UserModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, WxService, SensitiveService],
  exports: [JwtModule, AuthService],
})
export class AuthModule {}
