import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // H5 适配：Next 15 内置 viewport 配置，见 app/layout.tsx
  async rewrites() {
    // 浏览器直连同源 /api，由 Nginx 反代到 NestJS，天然避免 CORS
    return [{ source: '/api/:path*', destination: `${process.env.INTERNAL_API_URL ?? 'http://localhost:3001'}/api/:path*` }];
  },
  poweredByHeader: false,
  compress: true,
};

export default nextConfig;
