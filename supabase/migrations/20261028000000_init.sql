-- ============================================================
--  0001_init.sql · AI 健康助手 初始 schema
--  目标：Supabase Postgres (含 pgvector)
--  执行：supabase db push  或 粘贴到 Supabase SQL Editor
-- ============================================================

create extension if not exists vector;      -- pgvector
create extension if not exists pg_trgm;     -- 中文关键词模糊检索（bigram）
create extension if not exists pgcrypto;    -- gen_random_uuid()

-- ------------------------------------------------------------
-- 枚举
-- ------------------------------------------------------------
do $$ begin
  create type public.user_role      as enum ('user', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.message_role   as enum ('user', 'assistant', 'system', 'tool');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.metric_type    as enum (
    'blood_pressure', 'blood_glucose', 'heart_rate',
    'weight', 'height', 'steps', 'sleep', 'water', 'mood'
  );
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 通用：updated_at 自动维护
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ------------------------------------------------------------
-- 用户资料（一对一扩展 auth.users）
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text unique,
  phone         text unique,
  nickname      text,
  avatar_url    text,
  role          public.user_role not null default 'user',
  wechat_unionid text unique,
  status        text not null default 'active',     -- active | banned
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- auth.users 新增时自动建 profile
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, phone, nickname, avatar_url)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(new.raw_user_meta_data->>'nickname', split_part(coalesce(new.email, 'user'), '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 健康档案（Agent 的“长期记忆”与工具查询对象）
-- ------------------------------------------------------------
create table if not exists public.health_profiles (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  gender             text check (gender in ('male','female','other')),
  birth_date         date,
  height_cm          numeric(5,2),
  weight_kg          numeric(5,2),
  blood_type         text,
  allergies          text[] not null default '{}',
  chronic_conditions text[] not null default '{}',
  medications        text[] not null default '{}',
  family_history     text[] not null default '{}',
  smoking            text check (smoking in ('never','former','current')),
  drinking           text check (drinking in ('never','light','moderate','heavy')),
  exercise_freq      text,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id)
);

-- ------------------------------------------------------------
-- 健康指标时序（血压、血糖、体重、步数…）
-- ------------------------------------------------------------
create table if not exists public.health_metrics (
  id           bigserial primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  type         public.metric_type not null,
  -- 结构化取值，例如 {"systolic":120,"diastolic":80} / {"value":5.6,"unit":"mmol/L"}
  value        jsonb not null,
  measured_at  timestamptz not null default now(),
  source       text,                       -- manual | device | import
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_metrics_user_time
  on public.health_metrics (user_id, type, measured_at desc);

-- ------------------------------------------------------------
-- RAG 知识库：文档 + 分片 + 向量
-- ------------------------------------------------------------
create table if not exists public.knowledge_docs (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  category     text,                        -- nutrition | chronic | mental | first_aid | medication ...
  source_name  text not null,               -- 国家卫健委 / 中国疾控中心 ...
  source_url   text,
  license      text,                        -- 公开来源授权说明，商用前务必自查
  published_at date,
  created_at   timestamptz not null default now()
);

-- 注意：embedding 维度需与 EMBEDDING_DIM 一致（bge-m3 = 1024，text-embedding-3-small = 1536）
create table if not exists public.knowledge_chunks (
  id         bigserial primary key,
  doc_id     uuid not null references public.knowledge_docs(id) on delete cascade,
  seq        int not null,                  -- 分片序号，用于拼接上下文
  content    text not null,
  tokens     int,
  embedding  vector(1024),
  metadata   jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (doc_id, seq)
);

-- 向量索引（HNSW：余弦距离）
create index if not exists idx_chunks_embedding
  on public.knowledge_chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- 关键词索引（中文用 trigram 兜底）
create index if not exists idx_chunks_content_trgm
  on public.knowledge_chunks using gin (content gin_trgm_ops);

-- ------------------------------------------------------------
-- 对话
-- ------------------------------------------------------------
create table if not exists public.chat_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null default '新对话',
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sessions_user on public.chat_sessions (user_id, updated_at desc);

create table if not exists public.chat_messages (
  id         bigserial primary key,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       public.message_role not null,
  content    text,
  -- [{"chunk_id":1,"doc_title":"...","source_url":"...","snippet":"...","score":0.82}]
  citations  jsonb,
  -- Agent 工具调用留痕，便于前端渲染“正在查询你的血压…”
  tool_calls jsonb,
  tokens     int,
  latency_ms int,
  created_at timestamptz not null default now()
);
create index if not exists idx_messages_session on public.chat_messages (session_id, id);

-- ------------------------------------------------------------
-- 触发器
-- ------------------------------------------------------------
drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_health_profiles_touch on public.health_profiles;
create trigger trg_health_profiles_touch before update on public.health_profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_sessions_touch on public.chat_sessions;
create trigger trg_sessions_touch before update on public.chat_sessions
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- RLS 辅助函数（security definer，避免策略递归）
-- ------------------------------------------------------------
create or replace function public.current_role()
returns text language sql stable security definer set search_path = public as $$
  select role::text from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ------------------------------------------------------------
-- RLS 策略
-- ------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.health_profiles  enable row level security;
alter table public.health_metrics   enable row level security;
alter table public.chat_sessions    enable row level security;
alter table public.chat_messages    enable row level security;
alter table public.knowledge_docs   enable row level security;
alter table public.knowledge_chunks enable row level security;

-- profiles：本人可读写，管理员可看全部
drop policy if exists p_profiles_self on public.profiles;
create policy p_profiles_self on public.profiles
  for select using (id = auth.uid() or public.is_admin());
drop policy if exists p_profiles_update_self on public.profiles;
create policy p_profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- 业务表：仅本人 + 管理员只读
do $$
declare t text;
begin
  foreach t in array array['health_profiles','health_metrics','chat_sessions','chat_messages']
  loop
    execute format('drop policy if exists p_owner_all on public.%I', t);
    execute format(
      'create policy p_owner_all on public.%I for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid())',
      t
    );
  end loop;
end $$;

-- 知识库：登录用户只读（写入一律走 service_role，绕过 RLS）
drop policy if exists p_docs_read on public.knowledge_docs;
create policy p_docs_read on public.knowledge_docs
  for select to authenticated using (true);

drop policy if exists p_chunks_read on public.knowledge_chunks;
create policy p_chunks_read on public.knowledge_chunks
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- RAG 检索函数（RPC）
-- ------------------------------------------------------------
-- 纯向量检索
create or replace function public.match_knowledge_chunks(
  query_embedding vector(1024),
  match_count     int   default 6,
  filter_category text  default null,
  min_score       float default 0.0
)
returns table (
  chunk_id   bigint,
  doc_id     uuid,
  doc_title  text,
  source_url text,
  content    text,
  metadata   jsonb,
  score      float
)
language sql stable as $$
  select
    c.id,
    c.doc_id,
    d.title,
    d.source_url,
    c.content,
    c.metadata,
    1 - (c.embedding <=> query_embedding) as score
  from public.knowledge_chunks c
  join public.knowledge_docs d on d.id = c.doc_id
  where c.embedding is not null
    and (filter_category is null or d.category = filter_category)
    and 1 - (c.embedding <=> query_embedding) > min_score
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- 混合检索：向量 + 关键词，按权重融合
create or replace function public.hybrid_search_chunks(
  query_embedding vector(1024),
  query_text      text,
  match_count     int   default 6,
  vector_weight   float default 0.7,
  filter_category text  default null
)
returns table (
  chunk_id   bigint,
  doc_id     uuid,
  doc_title  text,
  source_url text,
  content    text,
  metadata   jsonb,
  score      float
)
language sql stable as $$
  with vec as (
    select c.id, greatest(0, 1 - (c.embedding <=> query_embedding)) as v_score
    from public.knowledge_chunks c
    join public.knowledge_docs d on d.id = c.doc_id
    where c.embedding is not null
      and (filter_category is null or d.category = filter_category)
    order by c.embedding <=> query_embedding
    limit 50
  ),
  kw as (
    select c.id,
           similarity(c.content, query_text) as k_score
    from public.knowledge_chunks c
    where query_text is not null and length(query_text) > 0
    order by k_score desc
    limit 50
  )
  select
    c.id,
    c.doc_id,
    d.title,
    d.source_url,
    c.content,
    c.metadata,
    (coalesce(v.v_score, 0) * vector_weight
     + coalesce(k.k_score, 0) * (1 - vector_weight))::float as score
  from public.knowledge_chunks c
  join public.knowledge_docs d on d.id = c.doc_id
  left join vec v on v.id = c.id
  left join kw  k on k.id = c.id
  where v.id is not null or k.id is not null
  order by score desc
  limit match_count;
$$;

-- ------------------------------------------------------------
-- 管理员看板：健康档案统计（service_role / admin 调用）
-- ------------------------------------------------------------
create or replace function public.admin_overview()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'users',   (select count(*) from public.profiles),
    'sessions',(select count(*) from public.chat_sessions),
    'messages',(select count(*) from public.chat_messages),
    'docs',    (select count(*) from public.knowledge_docs),
    'chunks',  (select count(*) from public.knowledge_chunks)
  );
$$;
