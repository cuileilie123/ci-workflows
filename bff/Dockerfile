# ============================================================
# 邻里互助 BFF - 多阶段 Docker 构建
# ============================================================

# ---- 构建阶段 ----
FROM node:20-alpine AS builder

WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm@9

# 先复制依赖定义文件，利用 Docker 缓存
COPY package.json pnpm-lock.yaml* ./

# 安装所有依赖（包括 devDependencies，用于构建）
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# 复制源代码
COPY . .

# 生成 Prisma Client
RUN npx prisma generate

# 构建 NestJS 应用
RUN pnpm build

# ---- 生产阶段 ----
FROM node:20-alpine AS production

# 安装 curl 用于健康检查
RUN apk add --no-cache curl

WORKDIR /app

# 创建非 root 用户
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# 复制构建产物和必要文件
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh

# 创建 uploads 目录并设置权限
RUN mkdir -p /app/uploads && \
    chown -R appuser:appgroup /app

# 赋予启动脚本执行权限
RUN chmod +x /app/docker-entrypoint.sh

# 切换到非 root 用户
USER appuser

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1 || exit 1

# 暴露端口
EXPOSE 3000

# 启动命令（自动执行数据库迁移）
ENTRYPOINT ["/app/docker-entrypoint.sh"]
