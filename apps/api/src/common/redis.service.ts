import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** 用途：限流计数、SSE 断线续传缓冲、热点问答缓存、JWT 刷新黑名单 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(cfg: ConfigService) {
    this.client = new Redis({
      host: cfg.get<string>('REDIS_HOST') ?? 'redis',
      port: Number(cfg.get<number>('REDIS_PORT') ?? 6379),
      password: cfg.get<string>('REDIS_PASSWORD') || undefined,
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    this.client.on('error', (e) => this.logger.error(`Redis error: ${e.message}`));
  }

  /** 滑动窗口限流：返回是否放行 */
  async hit(key: string, limit: number, windowSec = 60): Promise<boolean> {
    const k = `rl:${key}`;
    const n = await this.client.incr(k);
    if (n === 1) await this.client.expire(k, windowSec);
    return n <= limit;
  }

  /** 命中缓存的问答（同一问题 5 分钟内复用） */
  async cacheGet(key: string): Promise<string | null> {
    return this.client.get(`qa:${key}`);
  }

  async cacheSet(key: string, value: string, ttlSec = 300): Promise<void> {
    await this.client.set(`qa:${key}`, value, 'EX', ttlSec);
  }

  async blacklist(jti: string, ttlSec: number): Promise<void> {
    await this.client.set(`bl:${jti}`, '1', 'EX', ttlSec);
  }

  async isBlacklisted(jti: string): Promise<boolean> {
    return (await this.client.exists(`bl:${jti}`)) === 1;
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
