import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * 两个客户端分工：
 *  - admin：service_role，绕过 RLS，只用于服务端可信写入（灌库、管理员操作）
 *  - user(token)：携带用户 JWT，所有查询受 RLS 约束 —— 默认走这个
 */
@Injectable()
export class SupabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(SupabaseService.name);
  readonly admin: SupabaseClient;

  constructor(cfg: ConfigService) {
    this.admin = createClient(
      cfg.get<string>('SUPABASE_URL')!,
      cfg.get<string>('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }

  /** 以用户身份访问，RLS 生效 */
  forUser(accessToken: string): SupabaseClient {
    return createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
  }

  async onModuleDestroy() {
    this.logger.log('Supabase client closed');
  }
}
