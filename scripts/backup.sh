#!/bin/bash
set -e

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup/mysql"
RETENTION_DAYS=30

echo "📦 开始备份 - $DATE"

# 1. 全量备份
mysqldump \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --all-databases \
  --hex-blob \
  -h ${MYSQL_HOST:-localhost} -u ${MYSQL_USER:-root} -p${MYSQL_PASSWORD} \
  | gzip > "$BACKUP_DIR/full_$DATE.sql.gz"

# 2. 验证
gunzip -c "$BACKUP_DIR/full_$DATE.sql.gz" | tail -5 | grep -q "Dump completed"
if [ $? -eq 0 ]; then
  echo "✅ 备份验证通过: $BACKUP_DIR/full_$DATE.sql.gz"
  echo "$DATE,full_$DATE.sql.gz,$(ls -la $BACKUP_DIR/full_$DATE.sql.gz | awk '{print $5}')" \
    >> "$BACKUP_DIR/backup_log.csv"
else
  echo "❌ 备份验证失败"
  exit 1
fi

# 3. 清理旧备份
find "$BACKUP_DIR" -name "full_*.sql.gz" -mtime +$RETENTION_DAYS -delete

echo "✅ 备份完成 - $(date)"
