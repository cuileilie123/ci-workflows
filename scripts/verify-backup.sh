#!/bin/bash
set -e

BACKUP_DIR="/backup/mysql"
RETENTION_DAYS=30

echo "🔍 验证备份完整性 - $(date)"

# 检查最近的全量备份
LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/full_*.sql.gz 2>/dev/null | head -1)

if [ -z "$LATEST_BACKUP" ]; then
  echo "❌ 未找到任何全量备份"
  exit 1
fi

echo "检查备份: $LATEST_BACKUP"

# 验证文件完整性（双校验：header + footer）
HEADER_OK=false
FOOTER_OK=false

# header 校验：兼容 MySQL dump 和 MariaDB dump
if gunzip -c "$LATEST_BACKUP" 2>/dev/null | head -10 | grep -qE "(MySQL|MariaDB) dump"; then
  HEADER_OK=true
fi

# footer 校验：检查 Dump completed 标记
if gunzip -c "$LATEST_BACKUP" 2>/dev/null | tail -5 | grep -q "Dump completed"; then
  FOOTER_OK=true
fi

if $HEADER_OK && $FOOTER_OK; then
  echo "✅ 最新备份验证通过 (header + footer)"
elif $FOOTER_OK && ! $HEADER_OK; then
  echo "⚠️  最新备份部分通过 (footer OK, header 未识别 - 可能使用非标准客户端)"
else
  echo "❌ 最新备份已损坏 (header=$HEADER_OK, footer=$FOOTER_OK)"
  exit 1
fi

# 检查备份日志
if [ -f "$BACKUP_DIR/backup_log.csv" ]; then
  echo "备份记录:"
  tail -5 "$BACKUP_DIR/backup_log.csv"
fi

echo "✅ 验证完成 - $(date)"
