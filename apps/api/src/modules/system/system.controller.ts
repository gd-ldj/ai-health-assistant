import { Controller, Get } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase.service';
import { RedisService } from '../../common/redis.service';

/** 容器 / Nginx 探活用，不鉴权 */
@Controller()
export class SystemController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly redis: RedisService,
  ) {}

  @Get('healthz')
  async healthz() {
    const redisOk = await this.redis.client.ping().then(() => true).catch(() => false);
    const { error } = await this.supabase.admin.from('knowledge_docs').select('id').limit(1);
    const dbOk = !error;
    return {
      status: dbOk && redisOk ? 'ok' : 'degraded',
      db: dbOk,
      redis: redisOk,
      ts: new Date().toISOString(),
    };
  }
}
