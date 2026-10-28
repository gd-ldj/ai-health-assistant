import { z } from 'zod';

/**
 * 启动即校验，缺变量直接崩，避免上线后半夜发现配置漏填。
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().default(3001),
  APP_URL: z.string().url(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少 32 位'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  REDIS_HOST: z.string().default('redis'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  RATE_LIMIT_PER_MIN: z.coerce.number().default(30),

  LLM_BASE_URL: z.string().url(),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().default('deepseek-chat'),
  LLM_TEMPERATURE: z.coerce.number().default(0.3),
  LLM_MAX_TOKENS: z.coerce.number().default(4096),

  EMBEDDING_BASE_URL: z.string().url(),
  EMBEDDING_API_KEY: z.string().min(1),
  EMBEDDING_MODEL: z.string().default('BAAI/bge-m3'),
  EMBEDDING_DIM: z.coerce.number().default(1024),

  RAG_TOP_K: z.coerce.number().default(6),
  RAG_SCORE_THRESHOLD: z.coerce.number().default(0.35),
  RAG_HYBRID_VECTOR_WEIGHT: z.coerce.number().default(0.7),

  WECHAT_ENABLED: z.coerce.boolean().default(false),
  WECHAT_APP_ID: z.string().optional(),
  WECHAT_APP_SECRET: z.string().optional(),

  MEDICAL_DISCLAIMER_ENABLED: z.coerce.boolean().default(true),
});

export type Env = z.infer<typeof envSchema>;
