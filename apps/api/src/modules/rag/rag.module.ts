import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { SupabaseService } from '../../common/supabase.service';
import { LlmService } from '../../common/llm.service';

@Module({
  providers: [RagService, SupabaseService, LlmService],
  exports: [RagService],
})
export class RagModule {}
