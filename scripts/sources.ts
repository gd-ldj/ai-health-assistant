/**
 * 知识库种子来源。
 *
 * ⚠️ 重要：抓取前必须先确认 robots.txt 与网站使用条款。
 *    运行 `pnpm check-sources` 会自动拉取每个来源的 robots.txt 并提示是否允许抓取。
 *    只允许收录明确公开发布的科普/指南类内容；有版权声明的内容不得入库。
 *    商用前请自行复核版权与《互联网诊疗监管细则》相关要求。
 */
export interface SeedSource {
  /** 来源机构名，写进 knowledge_docs.source_name，用于前端溯源展示 */
  name: string;
  /** 分类：nutrition | chronic | mental | first_aid | medication | maternal | infectious */
  category: string;
  /** 起始页，爬虫从这里发现正文链接 */
  entry: string;
  /** 只收录 URL 命中该正则的页面 */
  urlPattern: RegExp;
  /** 授权说明 */
  license: string;
  /** 单站最大抓取页数，别把人家网站抓爆 */
  maxPages: number;
}

export const SEED_SOURCES: SeedSource[] = [
  {
    name: '国家卫生健康委员会',
    category: 'chronic',
    entry: 'http://www.nhc.gov.cn/',
    urlPattern: /nhc\.gov\.cn\/.*\/(content|jkzn|jksh)\//,
    license: '政府公开信息，转载请注明来源；商用前复核',
    maxPages: 200,
  },
  {
    name: '中国疾病预防控制中心',
    category: 'infectious',
    entry: 'https://www.chinacdc.cn/',
    urlPattern: /chinacdc\.cn\/.*\/(jkzt|jkkp)\//,
    license: '政府公开信息，转载请注明来源；商用前复核',
    maxPages: 200,
  },
  {
    name: '国家中医药管理局',
    category: 'medication',
    entry: 'http://www.natcm.gov.cn/',
    urlPattern: /natcm\.gov\.cn\/.*\/(zykp|zysc)\//,
    license: '政府公开信息，转载请注明来源；商用前复核',
    maxPages: 100,
  },
  {
    name: '世界卫生组织（中文）',
    category: 'chronic',
    entry: 'https://www.who.int/zh/news-room/fact-sheets',
    urlPattern: /who\.int\/zh\/news-room\/fact-sheets\/detail\//,
    license: 'WHO 允许非商业转载并标注来源',
    maxPages: 80,
  },
];

/** 明显不是正文的链接，直接跳过 */
export const SKIP_PATTERNS: RegExp[] = [
  /\.(pdf|doc|docx|xls|xlsx|zip|rar|jpg|jpeg|png|gif|mp4)$/i,
  /\/(video|gallery|photo|download|print)/i,
];
