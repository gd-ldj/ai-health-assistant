import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { SupabaseService } from '../../common/supabase.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService, SupabaseService],
  exports: [HealthService],
})
export class HealthModule {}
