# AI 健康助手

> RAG 健康知识库问答 + 健康档案 Agent（工具调用）+ 流式对话。
> Next.js 15 / NestJS / Supabase (Postgres + pgvector) / Redis / Docker Compose / Nginx。

[![CI](https://github.com/OWNER/ai-health-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/ai-health-assistant/actions/workflows/ci.yml)

---

## ⚠️ 免责声明

本项目是**健康信息管理工具**，**不是医疗器械，不提供诊断、处方或治疗方案**。

- 所有 AI 回答仅供参考，不能替代执业医师的面诊与判断。
- 出现胸痛、呼吸困难、意识丧失、大出血、持续高热、抽搐等**危险信号**时，系统会拒绝给出结论并提示立即就医。
- 请勿依据本工具自行停药、减药或更改治疗方案。

---

## 架构

```
┌──────────── 浏览器 / H5 ────────────┐
│  Next.js 15 (App Router, RSC, SSE)   │
└──────────────┬───────────────────────┘
               │  /api/*  (Nginx 反代)
┌──────────────▼───────────────────────┐
│  NestJS                              │
│  ├─ Auth     JWT + RBAC + 可插拔 OAuth│
│  ├─ RAG      检索 → 重排 → 引用溯源   │
│  ├─ Agent    健康档案工具调用          │
│  └─ Stream   SSE 流式输出             │
└───┬───────────────┬──────────────┬────┘
    │               │              │
┌───▼─────┐  ┌──────▼──────┐  ┌────▼─────┐
│Supabase │  │   Redis     │  │  LLM     │
│Postgres │  │ 限流/缓存    │  │ 任意      │
│+pgvector│  │ 会话状态     │  │ OpenAI 兼容│
└─────────┘  └─────────────┘  └──────────┘
```

**为什么 pgvector 而不是 Milvus**：知识库规模在十万级分片以内时，pgvector 与业务库同库，可用一条 SQL 做「向量检索 + 关联文档元数据 + RLS 权限过滤」，省掉一整个分布式组件的运维成本。等分片量过百万再迁 Milvus 不迟，检索层已做接口隔离。

## 目录

```
apps/web        Next.js 15 前端（H5 适配）
apps/api        NestJS 后端
supabase/       迁移 SQL（schema / RLS / 检索函数）
scripts/        知识库抓取与向量化流水线
nginx/          反代配置（含 SSE 长连接）
.github/        CI（构建 + 密钥泄漏扫描）
```

## 快速开始

```bash
# 1. 安装依赖（需 Node ≥ 22 / pnpm ≥ 10）
pnpm install

# 2. 配置环境变量
cp .env.example .env
vim .env          # 填 Supabase、LLM、Redis、JWT

# 3. 建库（Supabase）
supabase db push  # 或在 Supabase SQL Editor 粘贴 supabase/migrations/*.sql

# 4. 灌入知识库
pnpm ingest

# 5. 本地开发
pnpm dev          # web:3000  api:3001
```

## 部署（京东云轻量云主机）

```bash
# 安全组放行 22 / 80 / 443
ssh root@<公网IP>

curl -fsSL https://get.docker.com | sh
git clone https://github.com/OWNER/ai-health-assistant.git && cd ai-health-assistant
cp .env.example .env && vim .env

# 申请证书
docker run --rm -it \
  -v "$PWD/certs:/etc/letsencrypt" -v "$PWD/nginx/certbot:/var/www/certbot" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d your-domain.com --email you@example.com --agree-tos
# 把 nginx/conf.d/ai-health.conf 里的 change-me 换成 your-domain.com

docker compose up -d --build
docker compose logs -f api
```

中国大陆节点用域名访问需完成 **ICP 备案**；未备案阶段可直接用 `http://<公网IP>` 调试（临时移除 HTTP→HTTPS 跳转）。

## 权限模型（RBAC）

| 角色 | 能力 |
|------|------|
| `user` | 自己的健康档案、指标、对话；只读知识库 |
| `admin` | 全部用户数据只读、知识库增删改、系统看板 |

权限在**两层**生效：NestJS `RolesGuard` 拦接口，Supabase **RLS** 拦数据行。绕过应用层也读不到别人的数据。

## 认证

- 邮箱 + 密码（Supabase Auth）
- 手机号 + 短信验证码（可选，需国内短信服务与备案签名）
- 微信登录：**可插拔 provider**，默认关闭。资质齐全后填 `WECHAT_APP_ID/SECRET` 并设 `WECHAT_ENABLED=true` 即可启用，无需改业务代码。

> 微信开放平台「网站应用」需企业主体 + 认证费 + 备案域名；公众号网页授权仅在微信内打开有效。个人开发者建议先跑邮箱/手机号。

## 合规与隐私

- 回答强制附带引用来源，可追溯到原文分片
- 敏感字段（病史、用药）加密存储，日志脱敏
- 系统提示词与用户输入分离，防 prompt 注入
- `.env` 永不入库，CI 内置密钥扫描

## 知识库数据来源

抓取仅限**明确公开发布的权威来源**（政府/疾控/医疗机构科普）。`supabase/knowledge_docs.license` 字段记录每个来源的授权说明。**商用前请自行复核版权与《互联网诊疗监管细则》相关要求。**

## License

[MIT](./LICENSE)
