import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { IsString } from 'class-validator';
import { SupabaseService } from '../../common/supabase.service';
import { Auth } from '../auth/roles.guard';

class DocDto {
  @IsString() title!: string;
  @IsString() source_name!: string;
  @IsString() category!: string;
  @IsString() source_url!: string;
  @IsString() license!: string;
}

/** 所有接口强制 admin；数据库侧 RLS 同样只放行 admin 行 */
@Controller('admin')
export class AdminController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get('overview')
  @Auth('admin')
  async overview() {
    const { data } = await this.supabase.admin.rpc('admin_overview');
    return data;
  }

  @Get('users')
  @Auth('admin')
  async users(@Req() req: any) {
    const { data } = await this.supabase.admin
      .from('profiles')
      .select('id, email, phone, nickname, role, status, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    return data ?? [];
  }

  @Get('knowledge')
  @Auth('admin')
  async docs() {
    const { data } = await this.supabase.admin
      .from('knowledge_docs')
      .select('id, title, category, source_name, source_url, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    return data ?? [];
  }

  @Post('knowledge')
  @Auth('admin')
  async createDoc(@Body() dto: DocDto) {
    const { data } = await this.supabase.admin.from('knowledge_docs').insert(dto).select().single();
    return data;
  }

  @Delete('knowledge/:id')
  @Auth('admin')
  async deleteDoc(@Param('id') id: string) {
    // 分片由外键 on delete cascade 连带删除
    await this.supabase.admin.from('knowledge_docs').delete().eq('id', id);
    return { ok: true };
  }
}
