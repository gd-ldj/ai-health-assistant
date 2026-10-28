import { load } from 'cheerio';

const u = 'https://www.who.int/zh/news-room/fact-sheets/detail/opioid-overdose';
const h = await (await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
const d = load(h);
d('script,style,nav,header,footer,aside').remove();
const t = (d('.article, .content, main, article').first().text() || d('body').text())
  .replace(/ /g, ' ')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const piece = t.slice(0, 580);
const variants: Array<[string, string]> = [
  ['raw580', piece],
  ['noNewline580', piece.replace(/\n/g, ' ')],
  ['len300', piece.slice(0, 300)],
  ['len150', piece.slice(0, 150)],
  ['repeat580', '高血压防治知识'.repeat(77)],
];

for (const [name, text] of variants) {
  const r = await fetch('http://ollama:11434/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'bge-m3', input: text }),
  });
  const j: any = await r.json();
  console.log(name, 'len=' + text.length, 'dim=' + (j.data ? j.data[0].embedding.length : JSON.stringify(j).slice(0, 80)));
}
