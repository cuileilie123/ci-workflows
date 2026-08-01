#!/bin/bash
set -e

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup/mysql/binlog"
mkdir -p "$BACKUP_DIR"

echo "📦 Binlog 增量备份 - $DATE"

# 刷新 Binlog
mysql -h "${MYSQL_HOST:-mysql}" -u "${MYSQL_USER:-root}" -p"${MYSQL_PASSWORD:-root123}" \
  -e "FLUSH BINARY LOGS;" 2>/dev/null

# 复制 Binlog 文件
if [ -d "/var/lib/mysql" ]; then
  cp /var/lib/mysql/mysql-bin.* "$BACKUP_DIR/" 2>/dev/null || true
  echo "✅ Binlog 已备份到 $BACKUP_DIR"
else
  echo "⚠️  /var/lib/mysql 不存在，跳过 Binlog 备份"
fi

echo "✅ Binlog 备份完成 - $(date)"
