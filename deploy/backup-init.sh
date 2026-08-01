#!/bin/bash
# ============================================================
# 社区邻里有偿互助平台 - 备份调度器初始化脚本
# ============================================================
# 由 docker-compose.backup.yml 的 entrypoint 调用
# 负责：等待 MySQL → 生成 cron 配置 → 启动 cron
# ============================================================

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  社区邻里有偿互助平台 - 备份调度器启动"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ---- 1. 等待 MySQL 就绪 ----
echo "[1/4] 等待 MySQL 就绪..."
MAX_RETRIES=30
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
    if mysqladmin ping -h "${MYSQL_HOST}" -u "${MYSQL_USER}" -p"${MYSQL_PASSWORD}" --silent 2>/dev/null; then
        echo "  [OK] MySQL 已就绪"
        break
    fi
    RETRY=$((RETRY + 1))
    echo "  等待中... ($RETRY/$MAX_RETRIES)"
    sleep 2
done
if [ $RETRY -eq $MAX_RETRIES ]; then
    echo "  [WARN] MySQL 启动超时，继续启动备份调度器"
fi

# ---- 2. 初始化目录和日志 ----
echo "[2/4] 初始化备份目录..."
mkdir -p /backup/mysql
chmod 755 /backup/mysql
touch /var/log/backup.log /var/log/binlog-backup.log /var/log/verify.log /var/log/cleanup.log

# ---- 3. 验证已有备份文件 ----
echo "[3/4] 验证已有备份文件..."
VALID_COUNT=0
INVALID_COUNT=0
TOTAL_BACKUPS=$(ls /backup/mysql/full_*.sql.gz 2>/dev/null | wc -l)

if [ "$TOTAL_BACKUPS" -gt 0 ]; then
    for f in /backup/mysql/full_*.sql.gz; do
        [ -f "$f" ] || continue
        HEADER_OK=false
        FOOTER_OK=false
        # header 校验：兼容 MySQL dump 和 MariaDB dump
        if gunzip -c "$f" 2>/dev/null | head -10 | grep -qE "(MySQL|MariaDB) dump"; then
            HEADER_OK=true
        fi
        # footer 校验：检查 Dump completed 标记
        if gunzip -c "$f" 2>/dev/null | tail -5 | grep -q "Dump completed"; then
            FOOTER_OK=true
        fi
        if $HEADER_OK && $FOOTER_OK; then
            VALID_COUNT=$((VALID_COUNT + 1))
        else
            INVALID_COUNT=$((INVALID_COUNT + 1))
            echo "  [WARN] 备份文件可能损坏: $(basename "$f") (header=$HEADER_OK, footer=$FOOTER_OK)"
        fi
    done
    echo "  已有备份: $TOTAL_BACKUPS 份 (有效: $VALID_COUNT, 可疑: $INVALID_COUNT)"
else
    echo "  暂无历史备份文件"
fi

# ---- 4. 配置 cron ----
echo "[4/4] 配置定时任务..."

# 创建环境变量文件
cat > /tmp/backup-env.sh << 'EOF'
export MYSQL_HOST=__MYSQL_HOST__
export MYSQL_PORT=__MYSQL_PORT__
export MYSQL_USER=__MYSQL_USER__
export MYSQL_PASSWORD=__MYSQL_PASSWORD__
export MYSQL_DATABASE=__MYSQL_DATABASE__
export BACKUP_DIR=__BACKUP_DIR__
export TZ=__TZ__
export COS_SECRET_ID=__COS_SECRET_ID__
export COS_SECRET_KEY=__COS_SECRET_KEY__
export COS_BUCKET=__COS_BUCKET__
export COS_REGION=__COS_REGION__
EOF

# 替换占位符为实际值
sed -i "s|__MYSQL_HOST__|${MYSQL_HOST}|g" /tmp/backup-env.sh
sed -i "s|__MYSQL_PORT__|${MYSQL_PORT}|g" /tmp/backup-env.sh
sed -i "s|__MYSQL_USER__|${MYSQL_USER}|g" /tmp/backup-env.sh
sed -i "s|__MYSQL_PASSWORD__|${MYSQL_PASSWORD}|g" /tmp/backup-env.sh
sed -i "s|__MYSQL_DATABASE__|${MYSQL_DATABASE}|g" /tmp/backup-env.sh
sed -i "s|__BACKUP_DIR__|${BACKUP_DIR}|g" /tmp/backup-env.sh
sed -i "s|__TZ__|${TZ}|g" /tmp/backup-env.sh
sed -i "s|__COS_SECRET_ID__|${COS_SECRET_ID}|g" /tmp/backup-env.sh
sed -i "s|__COS_SECRET_KEY__|${COS_SECRET_KEY}|g" /tmp/backup-env.sh
sed -i "s|__COS_BUCKET__|${COS_BUCKET}|g" /tmp/backup-env.sh
sed -i "s|__COS_REGION__|${COS_REGION}|g" /tmp/backup-env.sh

chmod 644 /tmp/backup-env.sh

# 生成 cron 配置
cat > /etc/cron.d/backup-cron << 'CRONEOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 每日 03:00 全量备份
0 3 * * * root source /tmp/backup-env.sh && bash /scripts/backup.sh >> /var/log/backup.log 2>&1

# 每 6 小时增量备份
0 */6 * * * root source /tmp/backup-env.sh && bash /scripts/binlog-backup.sh >> /var/log/binlog-backup.log 2>&1

# 每周日 04:00 完整性验证
0 4 * * 0 root source /tmp/backup-env.sh && bash /scripts/verify-backup.sh >> /var/log/verify.log 2>&1

# 每月 1 号 05:00 清理旧备份
0 5 1 * * root source /tmp/backup-env.sh && bash /scripts/cleanup-old-backups.sh >> /var/log/cleanup.log 2>&1
CRONEOF

chmod 0644 /etc/cron.d/backup-cron

echo "  [OK] Cron 定时任务已配置"

# ---- 启动 cron ----
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  备份调度器已启动"
echo "  定时任务:"
echo "    每日 03:00   - 全量备份"
echo "    每 6 小时    - 增量备份"
echo "    每周日 04:00 - 完整性验证"
echo "    每月 1 号    - 清理旧备份"
echo ""
echo "  查看日志: docker compose -f docker-compose.backup.yml logs -f"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exec cron -f
