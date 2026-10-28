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
        'User-Agent': 'AI-Health-Assistant-Bot/0.1 (+https://github.com/OWNER/ai-health-assistant)',
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

/** 中文按句读切分，再按字数合并，保留重叠避免上下文断裂 */
function chunk(text: string): string[] {
  const sentences = text
    .split(/(?<=[。！？；\n])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + s).length > CHUNK_SIZE && buf) {
      out.push(buf);
      buf = buf.slice(-CHUNK_OVERLAP) + s;
    } else {
      buf += s;
    }
  }
  if (buf.trim()) out.push(buf);

  // 丢掉过短的噪声块
  return out.filter((c) => c.length >= 40);
}

// ---------------------------------------------------------------- 向量化

async function embedBatch(texts: string[]): Promise<number[][]> {
  const BATCH = 16;
  const result: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const part = texts.slice(i, i + BATCH);
    const res = await embedClient.embeddings.create({ model: EMBED_MODEL, input: part });
    result.push(...res.data.map((d) => d.embedding));
    await sleep(200); // 轻踩限速
  }
  return result;
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
        .select('id')
        .eq('source_url', url)
        .maybeSingle();
      if (data) continue;
    }

    const html = await fetchText(url);
    if (!html) continue;

    const { title, clean, published } = extractArticle(html);
    if (clean.length < 200) continue; // 太短多半是导航页

    const { data: doc, error } = await supabase
      .from('knowledge_docs')
      .upsert(
        {
          title: title.slice(0, 200),
          category: src.category,
          source_name: src.name,
          source_url: url,
          license: src.license,
          published_at: published ? new Date(published).toISOString().slice(0, 10) : null,
        },
        { onConflict: 'source_url' },
      )
      .select('id')
      .single();

    if (error || !doc) {
      console.error(`  ✗ 写文档失败 ${url}: ${error?.message}`);
      continue;
    }

    const pieces = chunk(clean);
    if (!pieces.length) continue;

    const vectors = await embedBatch(pieces);
    const rows = pieces.map((content, i) => ({
      doc_id: doc.id,
      seq: i,
      content,
      tokens: Math.ceil(content.length / 1.6),
      embedding: vectors[i],
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
