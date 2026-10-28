import { Module, OnModuleInit, Injectable } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

import { envSchema, Env } from './config/env.schema';
import { SupabaseService } from './common/supabase.service';
import { RedisService } from './common/redis.service';
import { LlmService } from './common/llm.service';
import { AuthModule } from './modules/auth/auth.module';
import { ChatModule } from './modules/chat/chat.module';
import { RagModule } from './modules/rag/rag.module';
import { HealthModule } from './modules/health/health.module';
import { AdminModule } from './modules/admin/admin.module';
import { SystemController } from './modules/system/system.controller';

@Injectable()
class EnvGuard implements OnModuleInit {
  private readonly logger = new Logger('Env');
  constructor(private readonly cfg: ConfigService) {}
  onModuleInit() {
    const parsed = envSchema.safeParse(this.cfg['internalConfig'] ?? process.env);
    if (!parsed.success) {
      this.logger.error('环境变量校验失败：\n' + JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
      throw new Error('Invalid environment variables');
    }
    this.logger.log('环境变量校验通过');
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env>) => ({
        secret: cfg.get('JWT_SECRET', { infer: true })!,
        signOptions: { expiresIn: cfg.get('JWT_ACCESS_TTL', { infer: true }) },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => [
        { name: 'short', ttl: 60_000, limit: cfg.get<number>('RATE_LIMIT_PER_MIN') ?? 30 },
      ],
    }),
    AuthModule,
    ChatModule,
    RagModule,
    HealthModule,
    AdminModule,
  ],
  controllers: [SystemController],
  providers: [EnvGuard, SupabaseService, RedisService, LlmService],
  exports: [SupabaseService, RedisService, LlmService],
})
export class AppModule {}
