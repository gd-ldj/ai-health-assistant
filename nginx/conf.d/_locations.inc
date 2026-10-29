# 通用 location 片段：HTTP 与 HTTPS 两个 server 共用
# 文件名不以 .conf 结尾，避免被 conf.d/*.conf 自动加载

# 用 Docker 内置 DNS 做运行时解析。
# 若写成静态 upstream，容器重建后 IP 变化会一直 502，必须手动 reload nginx。
resolver 127.0.0.11 ipv6=off valid=10s;

set $aha_api "http://api:3001";
set $aha_web "http://web:3000";

# ---------- Let's Encrypt HTTP-01 校验（cerbot webroot）----------
location /.well-known/acme-challenge/ {
    root /var/www/certbot;
    default_type text/plain;
}

# ---------- API（含 SSE 流式对话）----------
location /api/ {
    # 用变量 + $request_uri 才能走运行时解析，同时保留 /api 前缀
    # （NestJS 侧 setGlobalPrefix('api')，两边只能保留一处）
    proxy_pass         $aha_api$request_uri;
    proxy_http_version 1.1;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # SSE 关键：关闭缓冲，否则前端收不到增量流
    proxy_buffering    off;
    proxy_cache        off;
    gzip               off;
    chunked_transfer_encoding on;
    proxy_read_timeout 3600s;

    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
}

# ---------- Next.js 前端 ----------
location / {
    proxy_pass         $aha_web$request_uri;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
}

location /_next/static/ {
    proxy_pass $aha_web$request_uri;
    proxy_set_header Host $host;
    expires 365d;
    add_header Cache-Control "public, immutable";
}

location = /healthz {
    access_log off;
    add_header Content-Type text/plain;
    return 200 "ok\n";
}
