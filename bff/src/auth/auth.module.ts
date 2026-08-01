import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UserModule } from '../modules/user/user.module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'nh_dev_jwt_secret_2026_change_in_production',
      signOptions: { expiresIn: '7d' },
    }),
    UserModule,
  ],
  exports: [JwtModule],
})
export class AuthModule {}
