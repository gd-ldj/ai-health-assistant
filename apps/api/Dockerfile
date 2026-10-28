# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate

COPY pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
# 国内机器走 npmmirror，境外可删掉这行
RUN npm config set registry https://registry.npmmirror.com
RUN pnpm install --no-frozen-lockfile

COPY apps/api ./apps/api
RUN pnpm --filter @aha/api build

# ---------- runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S nodejs && adduser -S nest -G nodejs

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/package.json ./apps/api/

USER nest
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
