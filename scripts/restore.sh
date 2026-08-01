#!/bin/bash
set -e

BACKUP_FILE=$1
if [ -z "$BACKUP_FILE" ]; then
  echo "用法: $0 <backup_file.sql.gz>"
  echo "可用备份:"
  ls -lt /backup/mysql/full_*.sql.gz 2>/dev/null || echo "  无本地备份"
  exit 1
fi

echo "⚠️  即将恢复数据库: $BACKUP_FILE"
echo "目标数据库: ${MYSQL_DATABASE:-neighborhood_help}"
read -r -p "确认恢复？(yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "已取消"
  exit 0
fi

# 1. 下载备份
echo "📥 准备备份文件..."
if [[ "$BACKUP_FILE" == cos://* ]]; then
  echo "从 COS 下载..."
  coscmd download "$BACKUP_FILE" /tmp/restore.sql.gz
elif [[ "$BACKUP_FILE" == s3://* ]]; then
  echo "从 S3 下载..."
  aws s3 cp "$BACKUP_FILE" /tmp/restore.sql.gz
else
  cp "$BACKUP_FILE" /tmp/restore.sql.gz
fi

# 2. 验证文件完整性
echo "🔍 验证备份文件..."
# 兼容 MySQL dump 和 MariaDB dump 的 header
if ! gunzip -c /tmp/restore.sql.gz 2>/dev/null | head -10 | grep -qE "(MySQL|MariaDB) dump"; then
  echo "❌ 备份文件损坏或格式错误"
  exit 1
fi

# 3. 创建恢复前的自动备份
echo "📦 创建恢复前快照..."
mysqldump --single-transaction \
  -h "${MYSQL_HOST:-mysql}" -u "${MYSQL_USER:-root}" -p"${MYSQL_PASSWORD:-root123}" \
  "${MYSQL_DATABASE:-neighborhood_help}" \
  | gzip > "/tmp/pre_restore_$(date +%Y%m%d_%H%M%S).sql.gz"

# 4. 执行恢复
#    新版 dump (--databases) 包含 CREATE DATABASE / USE 语句，直接 pipe 即可
#    旧版 dump (--all-databases) 也兼容，因为包含相同语句
echo "🔄 开始恢复..."
gunzip -c /tmp/restore.sql.gz | mysql \
  -h "${MYSQL_HOST:-mysql}" -u "${MYSQL_USER:-root}" -p"${MYSQL_PASSWORD:-root123}"

# 5. 验证恢复结果
echo "✅ 验证恢复结果..."
TABLE_COUNT=$(mysql -h "${MYSQL_HOST:-mysql}" -u "${MYSQL_USER:-root}" -p"${MYSQL_PASSWORD:-root123}" \
  -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${MYSQL_DATABASE:-neighborhood_help}'" -N 2>/dev/null)
echo "恢复完成，共 ${TABLE_COUNT} 张表"

# 6. 清理
rm -f /tmp/restore.sql.gz

echo "🎉 数据库恢复完成！"
