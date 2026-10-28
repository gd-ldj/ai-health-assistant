import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { WechatProvider } from './wechat.provider';
import { SupabaseService } from '../../common/supabase.service';
import { RedisService } from '../../common/redis.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET')!,
        signOptions: { expiresIn: cfg.get<string>('JWT_ACCESS_TTL') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, WechatProvider, SupabaseService, RedisService],
  exports: [AuthService],
})
export class AuthModule {}
