#!/bin/bash
set -e

BACKUP_DIR="/backup/mysql"
RETENTION_DAYS=30

echo "🧹 清理旧备份 - $(date)"

# 清理本地超过 30 天的全量备份
DELETED_COUNT=0
if [ -d "$BACKUP_DIR" ]; then
  while IFS= read -r file; do
    if [ -n "$file" ]; then
      rm -f "$file"
      echo "🗑️  已删除: $(basename "$file")"
      DELETED_COUNT=$((DELETED_COUNT + 1))
    fi
  done < <(find "$BACKUP_DIR" -name "full_*.sql.gz" -mtime +$RETENTION_DAYS 2>/dev/null)
fi

# 清理 COS 上超过 30 天的备份
if command -v coscmd &> /dev/null; then
  echo "清理 COS 旧备份..."
  coscmd list | grep "backups/mysql/full_" | while read -r line; do
    FILE_DATE=$(echo "$line" | grep -oP 'full_\K[0-9_]+')
    if [ -n "$FILE_DATE" ]; then
      FILE_EPOCH=$(date -d "${FILE_DATE:0:8}" +%s 2>/dev/null || date -j -f "%Y%m%d" "${FILE_DATE:0:8}" +%s 2>/dev/null || echo 0)
      NOW_EPOCH=$(date +%s)
      DIFF=$(( (NOW_EPOCH - FILE_EPOCH) / 86400 ))
      if [ "$DIFF" -gt "$RETENTION_DAYS" ] 2>/dev/null; then
        coscmd rm "backups/mysql/full_$FILE_DATE.sql.gz"
        echo "🗑️  已从 COS 删除: full_$FILE_DATE.sql.gz"
      fi
    fi
  done
fi

echo "✅ 清理完成 - 删除了 $DELETED_COUNT 个本地备份文件"
