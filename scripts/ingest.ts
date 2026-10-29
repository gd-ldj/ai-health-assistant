/**
 * 知识库灌入流水线：发现链接 → 抽取正文 → 分块 → 向量化 → 写入 Supabase
 *
 * 用法：
 *   pnpm ingest            # 增量：跳过已收录的 URL
 *   pnpm ingest --force    # 全量重建
 *
 * 前置：
 *   1. 先跑 `pnpm check-sources` 确认 robots.txt 允许抓取
 *   2. .env 配好 SUPABASE_* 与 EMBEDDING_*
 *   3. knowledge_chunks.embedding 维度必须与 EMBEDDING_DIM 一致
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import * as cheerio from 'cheerio';
import { SEED_SOURCES, SKIP_PATTERNS, type SeedSource } from './sources.js';

const CHUNK_SIZE = Number(process.env.RAG_CHUNK_SIZE ?? 600);
const CHUNK_OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP ?? 80);
const FORCE = process.argv.includes('--force');

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const embedClient = new OpenAI({
  apiKey: process.env.EMBEDDING_API_KEY!,
  baseURL: process.env.EMBEDDING_BASE_URL!,
});
const EMBED_MODEL = process.env.EMBEDDING_MODEL ?? 'BAAI/bge-m3';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 抓取

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'AI-Health-Assistant-Bot/0.1 (+https://github.com/gd-ldj/ai-health-assistant)',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractArticle(html: string) {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, aside, iframe, .ad, .share, .breadcrumb').remove();

  const title = ($('h1').first().text() || $('title').text()).trim();
  // 优先常见正文容器，退化为全文
  const body =
    $('.article, .content, .TRS_Editor, .detail, article, main').first().text() || $('body').text();

  const clean = body
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const published =
    $('meta[property="article:published_time"]').attr('content') ??
    $('meta[name="pubdate"]').attr('content') ??
    null;

  return { title, clean, published };
}

async function discoverLinks(src: SeedSource): Promise<string[]> {
  const html = await fetchText(src.entry);
  if (!html) return [];
  const $ = cheerio.load(html);
  const base = new URL(src.entry);

  const links = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    let abs: string;
    try {
      abs = new URL(href, base).toString();
    } catch {
      return;
    }
    if (!src.urlPattern.test(abs)) return;
    if (SKIP_PATTERNS.some((p) => p.test(abs))) return;
    links.add(abs);
  });

  return [...links].slice(0, src.maxPages);
}

// ---------------------------------------------------------------- 分块

/** 单块硬上限：超过模型上下文会被截断，Ollama 会返回降维向量 */
const MAX_PIECE = 1500;

/** 中文按句读切分，再按字数合并，保留重叠避免上下文断裂 */
function chunk(text: string): string[] {
  const sentences = text
    .split(/(?<=[。！？；\n])/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 没有句读的超长段落（表格、列表、整页正文）强制按字切，避免产生巨块
  const normalized: string[] = [];
  for (const s of sentences) {
    if (s.length <= MAX_PIECE) {
      normalized.push(s);
    } else {
      for (let p = 0; p < s.length; p += MAX_PIECE) {
        normalized.push(s.slice(p, p + MAX_PIECE));
      }
    }
  }

  const out: string[] = [];
  let buf = '';
  for (const s of normalized) {
    if ((buf + s).length > CHUNK_SIZE && buf) {
      out.push(buf);
      buf = buf.slice(-CHUNK_OVERLAP) + s;
    } else {
      buf += s;
    }
    if (buf.length > MAX_PIECE) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf);

  // 丢掉过短的噪声块
  return out.filter((c) => c.length >= 40);
}

// ---------------------------------------------------------------- 向量化

/**
 * 逐条向量化。
 * 实测 Ollama 的 /v1/embeddings 在批量入参时会偶发少返回或返回降维向量，
 * 单条调用 100% 稳定（2 核机器上本来也快不了多少，稳定性优先）。
 */
const EMBED_URL = `${(process.env.EMBEDDING_BASE_URL ?? 'http://ollama:11434/v1').replace(/\/$/, '')}/embeddings`;

/**
 * 向量化用原生 fetch 而非 OpenAI SDK：
 * 同一段文本走 SDK 时 Ollama 会返回 256 维（降维），原生请求稳定 1024 维。
 */
async function embedOne(text: string): Promise<number[] | null> {
  const DIM = Number(process.env.EMBEDDING_DIM ?? 1024);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(EMBED_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.EMBEDDING_API_KEY ?? ''}` },
        body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 1500) }),
      });
      const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
      const v = json.data?.[0]?.embedding;
      if (v && v.length === DIM) return v;
    } catch {
      /* 重试 */
    }
  }
  return null;
}

async function embedBatch(texts: string[]): Promise<Array<number[] | null>> {
  const out: Array<number[] | null> = [];
  for (const t of texts) out.push(await embedOne(t));
  return out;
}

// ---------------------------------------------------------------- 主流程

async function ingestSource(src: SeedSource) {
  console.log(`\n▶ ${src.name}  ${src.entry}`);
  const links = await discoverLinks(src);
  console.log(`  发现 ${links.length} 个候选页面`);

  let docs = 0;
  let chunks = 0;

  for (const url of links) {
    if (!FORCE) {
      const { data } = await supabase
        .from('knowledge_docs')
        .select('id, knowledge_chunks(count)')
        .eq('source_url', url)
        .maybeSingle();
      const chunkCount = (data as any)?.knowledge_chunks?.[0]?.count ?? 0;
      // 已收录且分片完整才跳过；上次向量化失败留下的空壳文档要补跑
      if (data && chunkCount > 0) continue;
    }

    const html = await fetchText(url);
    if (!html) continue;

    const { title, clean, published } = extractArticle(html);
    if (clean.length < 200) continue; // 太短多半是导航页

    // 已在上面做过 source_url 去重，这里直接 insert；
    // 若库上建了 source_url 唯一索引，可改回 upsert({ onConflict: 'source_url' })
    const { data: doc, error } = await supabase
      .from('knowledge_docs')
      .insert({
          title: title.slice(0, 200),
          category: src.category,
          source_name: src.name,
          source_url: url,
          license: src.license,
          published_at: published ? new Date(published).toISOString().slice(0, 10) : null,
      })
      .select('id')
      .single();

    if (error || !doc) {
      console.error(`  ✗ 写文档失败 ${url}: ${error?.message}`);
      continue;
    }

    const pieces = chunk(clean);
    if (!pieces.length) continue;

    const vectors = (await embedBatch(pieces)).filter((v): v is number[] => v !== null);
    if (vectors.length !== pieces.length) {
      console.warn(`  ! 丢弃 ${pieces.length - vectors.length} 片无法向量化的内容`);
    }

    const rows = pieces
      .map((content, i) => ({ content, vector: vectors[i], seq: i }))
      .filter((r) => r.vector)
      .map(({ content, vector, seq }) => ({
        doc_id: doc.id,
        seq,
        content,
        tokens: Math.ceil(content.length / 1.6),
        embedding: vector,
        metadata: { source: src.name, category: src.category },
      }));

    const { error: ce } = await supabase.from('knowledge_chunks').upsert(rows, {
      onConflict: 'doc_id,seq',
    });
    if (ce) {
      console.error(`  ✗ 写分片失败 ${url}: ${ce.message}`);
      continue;
    }

    docs += 1;
    chunks += rows.length;
    console.log(`  ✓ ${title.slice(0, 40)}  (${rows.length} 片)`);
    await sleep(500); // 对被抓取站点保持礼貌
  }

  console.log(`  ${src.name} 完成：${docs} 篇 / ${chunks} 片`);
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.EMBEDDING_API_KEY) {
    console.error('请先配置 .env（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / EMBEDDING_*）');
    process.exit(1);
  }
  for (const src of SEED_SOURCES) {
    await ingestSource(src);
  }
  console.log('\n全部完成');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
