/**
 * 抓取合规自检：拉取每个种子来源的 robots.txt，判断我们的 User-Agent 是否被允许。
 *
 * 这一步是硬性前置 —— 别跳过。跑完把 Disallow 的来源从 sources.ts 里删掉再灌库。
 *   pnpm check-sources
 */

import { SEED_SOURCES } from './sources.js';

const UA = 'AI-Health-Assistant-Bot/0.1';

/**
 * 极简 robots.txt 判定：
 *  - 找适用于 * 或我们 UA 的 group
 *  - 命中 Disallow 前缀即禁止（Allow 优先）
 * 生产场景建议换成 robotstxt / robots-parser 库做完整解析。
 */
function isAllowed(robotsTxt: string, path: string): boolean {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());
  let applies = false;
  let allowed = true;
  let sawRule = false;

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey?.toLowerCase().trim();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      applies = value === '*' || value.toLowerCase().includes('ai-health-assistant');
      continue;
    }
    if (!applies) continue;

    if (key === 'disallow') {
      if (value === '') { allowed = true; sawRule = true; continue; }
      if (path.startsWith(value)) { allowed = false; sawRule = true; }
    } else if (key === 'allow') {
      if (path.startsWith(value) && value !== '') { allowed = true; sawRule = true; }
    }
  }

  return sawRule ? allowed : true;
}

async function check() {
  console.log('robots.txt 合规自检\n' + '─'.repeat(56));

  for (const src of SEED_SOURCES) {
    const { origin, pathname } = new URL(src.entry);
    const robotsUrl = `${origin}/robots.txt`;

    let verdict = '⚠️ 无法获取，默认拒绝';
    let allowed = false;

    try {
      const res = await fetch(robotsUrl, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const txt = await res.text();
        allowed = isAllowed(txt, pathname);
        verdict = allowed ? '✅ 允许抓取' : '❌ robots.txt 禁止';
      } else if (res.status === 404) {
        allowed = true;
        verdict = '✅ 无 robots.txt（默认允许，但仍需复核使用条款）';
      }
    } catch (e: any) {
      verdict = `⚠️ 请求失败：${e.message}`;
    }

    console.log(`${allowed ? ' ' : '!'} ${src.name.padEnd(14, '　')} ${verdict}`);
    console.log(`  ${src.entry}`);
  }

  console.log('─'.repeat(56));
  console.log('提示：robots.txt 只代表技术许可，不等于版权授权。');
  console.log('      正式商用前请逐站核对版权与内容使用条款。');
}

check();
