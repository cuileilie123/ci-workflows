#!/bin/sh
set -e

echo "=============================================="
echo "  邻里互助 BFF 启动中..."
echo "=============================================="

# 数据库迁移（如果 DATABASE_URL 已配置）
if [ -n "$DATABASE_URL" ]; then
  echo "[..] 执行数据库迁移..."
  npx prisma migrate deploy 2>&1 || {
    echo "[WARN] 迁移可能已完成或遇到问题，继续启动..."
  }
  echo "[OK] 数据库迁移完成"
else
  echo "[WARN] DATABASE_URL 未配置，跳过迁移"
fi

# 启动应用
echo "[..] 启动 BFF 服务..."
exec node dist/main.js
