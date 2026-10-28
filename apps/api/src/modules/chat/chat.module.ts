import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { RagModule } from '../rag/rag.module';
import { HealthModule } from '../health/health.module';
import { SupabaseService } from '../../common/supabase.service';
import { LlmService } from '../../common/llm.service';
import { RedisService } from '../../common/redis.service';

@Module({
  imports: [
    RagModule,
    HealthModule,
    JwtModule.register({ secret: process.env.JWT_SECRET! }),
  ],
  controllers: [ChatController],
  providers: [ChatService, SupabaseService, LlmService, RedisService],
})
export class ChatModule {}
