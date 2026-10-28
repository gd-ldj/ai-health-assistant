import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { SupabaseService } from '../../common/supabase.service';

@Module({
  controllers: [AdminController],
  providers: [SupabaseService],
})
export class AdminModule {}
