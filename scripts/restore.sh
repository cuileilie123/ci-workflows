#!/bin/bash
set -e

BACKUP_FILE=$1
if [ -z "$BACKUP_FILE" ]; then
  echo "用法: $0 <backup_file.sql.gz>"
  exit 1
fi

echo "⚠️  即将恢复数据库"
read -p "确认恢复？(yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "已取消"
  exit 0
fi

# 1. 验证文件
gunzip -c "$BACKUP_FILE" | head -5 | grep -q "MySQL dump"
if [ $? -ne 0 ]; then
  echo "❌ 备份文件损坏"
  exit 1
fi

# 2. 恢复前快照
mysqldump --single-transaction -h ${MYSQL_HOST:-localhost} \
  -u ${MYSQL_USER:-root} -p${MYSQL_PASSWORD} \
  ${MYSQL_DATABASE:-neighborhood_help} | gzip > "/tmp/pre_restore_$(date +%Y%m%d).sql.gz"

# 3. 执行恢复
echo "🔄 开始恢复..."
gunzip -c "$BACKUP_FILE" | mysql \
  -h ${MYSQL_HOST:-localhost} -u ${MYSQL_USER:-root} -p${MYSQL_PASSWORD} \
  ${MYSQL_DATABASE:-neighborhood_help}

echo "🎉 恢复完成！"
