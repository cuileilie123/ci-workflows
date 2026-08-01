#!/bin/bash
set -e

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup/mysql"
COS_BUCKET="cos://neighborhood-help-1250000000/backups/mysql"
RETENTION_DAYS=30
DB_NAME="${MYSQL_DATABASE:-neighborhood_help}"

echo "📦 开始备份 - $DATE"
echo "   数据库: $DB_NAME"

mkdir -p "$BACKUP_DIR"

# 1. 全量备份（仅业务库，排除系统库）
#    --single-transaction: InnoDB 一致性快照，不锁表
#    --databases: 指定数据库名，包含 CREATE DATABASE / USE 语句
#    --hex-blob: BLOB 字段以十六进制导出，避免编码问题
#    --set-charset: 在 dump 中写入 SET NAMES utf8mb4，确保恢复时编码正确
mysqldump \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --databases "$DB_NAME" \
  --hex-blob \
  --set-charset \
  --default-character-set=utf8mb4 \
  -h "${MYSQL_HOST:-mysql}" -u "${MYSQL_USER:-root}" -p"${MYSQL_PASSWORD:-root123}" \
  | gzip > "$BACKUP_DIR/full_$DATE.sql.gz"

# 2. 上传到腾讯云 COS
if command -v coscmd &> /dev/null && [ -n "${COS_SECRET_ID:-}" ] && [ -n "${COS_SECRET_KEY:-}" ]; then
  # 配置 coscmd（如果尚未配置）
  if ! coscmd config --list 2>/dev/null | grep -q 'secret_id'; then
    coscmd config --secret_id "$COS_SECRET_ID" --secret_key "$COS_SECRET_KEY" --region "${COS_REGION:-ap-guangzhou}" --bucket "${COS_BUCKET:-neighborhood-help-1250000000}" 2>/dev/null || true
  fi
  coscmd upload "$BACKUP_DIR/full_$DATE.sql.gz" "backups/mysql/full_$DATE.sql.gz" 2>/dev/null && \
    echo "☁️  已上传到 COS" || echo "⚠️  COS 上传失败（不影响本地备份）"
else
  echo "⚠️  coscmd 未配置，跳过 COS 上传"
fi

# 3. 增量备份（Binlog）
mysql -h "${MYSQL_HOST:-mysql}" -u "${MYSQL_USER:-root}" -p"${MYSQL_PASSWORD:-root123}" \
  -e "FLUSH BINARY LOGS;" 2>/dev/null || true

# 4. 清理旧备份（本地）
find "$BACKUP_DIR" -name "full_*.sql.gz" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true

# 5. 清理旧备份（COS）
if command -v coscmd &> /dev/null && [ -n "${COS_SECRET_ID:-}" ] && [ -n "${COS_SECRET_KEY:-}" ]; then
  coscmd list 2>/dev/null | grep "backups/mysql/full_" | while read -r line; do
    FILE_DATE=$(echo "$line" | grep -oP 'full_\K[0-9_]+')
    if [ -n "$FILE_DATE" ]; then
      FILE_EPOCH=$(date -d "${FILE_DATE:0:8}" +%s 2>/dev/null || date -j -f "%Y%m%d" "${FILE_DATE:0:8}" +%s 2>/dev/null || echo 0)
      NOW_EPOCH=$(date +%s)
      DIFF=$(( (NOW_EPOCH - FILE_EPOCH) / 86400 ))
      if [ "$DIFF" -gt "$RETENTION_DAYS" ] 2>/dev/null; then
        coscmd rm "backups/mysql/full_$FILE_DATE.sql.gz" 2>/dev/null || true
      fi
    fi
  done
fi

# 6. 验证备份完整性（双校验：header + footer）
BACKUP_FILE="$BACKUP_DIR/full_$DATE.sql.gz"
HEADER_OK=false
FOOTER_OK=false

# header 校验：兼容 MySQL dump 和 MariaDB dump
if gunzip -c "$BACKUP_FILE" 2>/dev/null | head -10 | grep -qE "(MySQL|MariaDB) dump"; then
  HEADER_OK=true
fi

# footer 校验：检查 Dump completed 标记
if gunzip -c "$BACKUP_FILE" 2>/dev/null | tail -5 | grep -q "Dump completed"; then
  FOOTER_OK=true
fi

if $HEADER_OK && $FOOTER_OK; then
  echo "✅ 备份验证通过 (header + footer)"
  echo "$DATE,full_$DATE.sql.gz,$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null || echo 'unknown')" \
    >> "$BACKUP_DIR/backup_log.csv"
elif $FOOTER_OK && ! $HEADER_OK; then
  echo "⚠️  备份验证部分通过 (footer OK, header 未识别)"
  echo "    可能使用了非标准 mysqldump 客户端"
  echo "$DATE,full_$DATE.sql.gz,$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null || echo 'unknown')" \
    >> "$BACKUP_DIR/backup_log.csv"
else
  echo "❌ 备份验证失败 (header=$HEADER_OK, footer=$FOOTER_OK)"
  exit 1
fi

echo "✅ 备份完成 - $(date)"
