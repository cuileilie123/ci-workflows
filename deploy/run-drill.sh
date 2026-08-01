#!/bin/bash
# ============================================================
# 备份恢复演练 - 完整执行脚本
# ============================================================
# 收集：环境信息、各阶段耗时、数据一致性验证结果
# ============================================================

set -euo pipefail

# ---------- 配置 ----------
MYSQL_HOST="${MYSQL_HOST:-mysql}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-root123}"
MYSQL_DATABASE="${MYSQL_DATABASE:-neighborhood_help}"
BACKUP_DIR="/backup/mysql"
DRILL_START=$(date +%s)
DRILL_DATE=$(date '+%Y-%m-%d %H:%M:%S %Z')

# ---------- 工具函数 ----------
sql() {
  mysql -h"$MYSQL_HOST" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -N -e "$1" 2>/dev/null
}

echo "============================================================"
echo "  备份恢复演练开始"
echo "  时间: $DRILL_DATE"
echo "  数据库: $MYSQL_DATABASE@$MYSQL_HOST"
echo "============================================================"
echo ""

# ---------- 0. 收集环境信息 ----------
echo "========== 阶段 0: 环境信息 =========="

DB_SIZE=$(sql "SELECT ROUND(SUM(data_length+index_length)/1024, 2) FROM information_schema.tables WHERE table_schema='$MYSQL_DATABASE';")
TABLE_COUNT=$(sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$MYSQL_DATABASE';")
USERS_COUNT=$(sql "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "N/A")
WALLETS_COUNT=$(sql "SELECT COUNT(*) FROM wallets;" 2>/dev/null || echo "N/A")
TASKS_COUNT=$(sql "SELECT COUNT(*) FROM tasks;" 2>/dev/null || echo "N/A")

echo "  数据库大小: ${DB_SIZE} KB"
echo "  业务表数量: $TABLE_COUNT"
echo "  users 记录数: $USERS_COUNT"
echo "  wallets 记录数: $WALLETS_COUNT"
echo "  tasks 记录数: $TASKS_COUNT"
echo ""

# ---------- 1. 准备测试数据 ----------
echo "========== 阶段 1: 准备测试数据 =========="
T1_START=$(date +%s%N)

TEST_TAG="drill_$(date +%s)"
TEST_OPENID="${TEST_TAG}_openid"
TEST_NICKNAME="drill_user_${TEST_TAG}"

sql "INSERT INTO users (openid, nickname, phone, credit_score, role, status, updated_at)
     VALUES ('$TEST_OPENID', '$TEST_NICKNAME', '13900000000', 95, 'USER', 'ACTIVE', NOW(3));"
TEST_USER_ID=$(sql "SELECT id FROM users WHERE openid='$TEST_OPENID';")
echo "  插入测试用户: ID=$TEST_USER_ID, openid=$TEST_OPENID"

sql "INSERT INTO wallets (user_id, balance, frozen, updated_at)
     VALUES ($TEST_USER_ID, 199.50, 10.00, NOW(3));"
echo "  插入测试钱包: balance=199.50, frozen=10.00"

sql "INSERT INTO tasks (publisher_id, title, description, price, lat, lng, geohash, address, category, images, status, expire_at, view_count, updated_at)
     VALUES ($TEST_USER_ID, 'drill_task_${TEST_TAG}', 'drill test task', 80.00, 39.9042000, 116.4074000, 'wx4g0', 'drill address', 'DELIVERY', '[]', 'OPEN', DATE_ADD(NOW(), INTERVAL 7 DAY), 25, NOW(3));"
TEST_TASK_ID=$(sql "SELECT id FROM tasks WHERE title='drill_task_${TEST_TAG}';")
echo "  插入测试任务: ID=$TEST_TASK_ID, price=80.00"

T1_END=$(date +%s%N)
T1_MS=$(( (T1_END - T1_START) / 1000000 ))
echo "  耗时: ${T1_MS}ms"
echo ""

# ---------- 2. 记录备份前数据特征 ----------
echo "========== 阶段 2: 记录备份前数据特征 =========="

USERS_BEFORE=$(sql "SELECT COUNT(*) FROM users;")
WALLETS_BEFORE=$(sql "SELECT COUNT(*) FROM wallets;")
TASKS_BEFORE=$(sql "SELECT COUNT(*) FROM tasks;")

USER_CS_BEFORE=$(sql "SELECT CONCAT(id,'|',openid,'|',nickname,'|',IFNULL(phone,''),'|',credit_score,'|',role,'|',status) FROM users WHERE id=$TEST_USER_ID;")
WALLET_CS_BEFORE=$(sql "SELECT CONCAT(user_id,'|',balance,'|',frozen) FROM wallets WHERE user_id=$TEST_USER_ID;")
TASK_CS_BEFORE=$(sql "SELECT CONCAT(id,'|',title,'|',price,'|',view_count,'|',status) FROM tasks WHERE id=$TEST_TASK_ID;")

echo "  users 总数: $USERS_BEFORE"
echo "  wallets 总数: $WALLETS_BEFORE"
echo "  tasks 总数: $TASKS_BEFORE"
echo "  用户特征: $USER_CS_BEFORE"
echo "  钱包特征: $WALLET_CS_BEFORE"
echo "  任务特征: $TASK_CS_BEFORE"
echo ""

# ---------- 3. 执行备份 ----------
echo "========== 阶段 3: 执行全量备份 =========="
T3_START=$(date +%s)

bash /scripts/backup.sh
T3_END=$(date +%s)
T3_SEC=$((T3_END - T3_START))

LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/full_*.sql.gz 2>/dev/null | head -1)
BACKUP_SIZE=$(stat -c%s "$LATEST_BACKUP" 2>/dev/null || echo 0)
BACKUP_NAME=$(basename "$LATEST_BACKUP")

echo "  备份文件: $BACKUP_NAME"
echo "  备份大小: ${BACKUP_SIZE} 字节"
echo "  备份耗时: ${T3_SEC}s"
echo ""

# ---------- 4. 验证备份文件完整性 ----------
echo "========== 阶段 4: 验证备份文件完整性 =========="

INTEGRITY_PASS=true

if gunzip -c "$LATEST_BACKUP" 2>/dev/null | tail -5 | grep -q "Dump completed"; then
  echo "  [PASS] 备份完整性校验: Dump completed 标记存在"
else
  echo "  [FAIL] 备份完整性校验: Dump completed 标记缺失"
  INTEGRITY_PASS=false
fi

if gunzip -c "$LATEST_BACKUP" 2>/dev/null | head -10 | grep -qE "(MySQL|MariaDB) dump"; then
  echo "  [PASS] 备份格式校验: dump header 存在"
else
  echo "  [FAIL] 备份格式校验: dump header 缺失"
  INTEGRITY_PASS=false
fi

if gunzip -c "$LATEST_BACKUP" 2>/dev/null | grep -q "$TEST_OPENID"; then
  echo "  [PASS] 备份内容校验: 包含测试用户数据"
else
  echo "  [FAIL] 备份内容校验: 缺少测试用户数据"
  INTEGRITY_PASS=false
fi

if gunzip -c "$LATEST_BACKUP" 2>/dev/null | grep -q "$TEST_TAG"; then
  echo "  [PASS] 备份内容校验: 包含测试任务数据"
else
  echo "  [FAIL] 备份内容校验: 缺少测试任务数据"
  INTEGRITY_PASS=false
fi
echo ""

# ---------- 5. 模拟数据丢失 ----------
echo "========== 阶段 5: 模拟数据丢失 =========="
T5_START=$(date +%s%N)

sql "DELETE FROM tasks WHERE id=$TEST_TASK_ID;"
sql "DELETE FROM wallets WHERE user_id=$TEST_USER_ID;"
sql "DELETE FROM users WHERE id=$TEST_USER_ID;"

T5_END=$(date +%s%N)
T5_MS=$(( (T5_END - T5_START) / 1000000 ))

USERS_AFTER_DEL=$(sql "SELECT COUNT(*) FROM users;")
WALLETS_AFTER_DEL=$(sql "SELECT COUNT(*) FROM wallets;")
TASKS_AFTER_DEL=$(sql "SELECT COUNT(*) FROM tasks;")

echo "  已删除: 测试用户、钱包、任务"
echo "  删除后 users: $USERS_AFTER_DEL (预期 $((USERS_BEFORE - 1)))"
echo "  删除后 wallets: $WALLETS_AFTER_DEL (预期 $((WALLETS_BEFORE - 1)))"
echo "  删除后 tasks: $TASKS_AFTER_DEL (预期 $((TASKS_BEFORE - 1)))"
echo "  删除耗时: ${T5_MS}ms"
echo ""

# ---------- 6. 执行恢复 ----------
echo "========== 阶段 6: 执行数据恢复 =========="
T6_START=$(date +%s)

echo "yes" | bash /scripts/restore.sh "$LATEST_BACKUP"

T6_END=$(date +%s)
T6_SEC=$((T6_END - T6_START))
echo "  恢复耗时: ${T6_SEC}s"
echo ""

# ---------- 7. 验证数据一致性 ----------
echo "========== 阶段 7: 数据一致性验证 =========="

CONSISTENCY_PASS=true

USERS_AFTER=$(sql "SELECT COUNT(*) FROM users;")
WALLETS_AFTER=$(sql "SELECT COUNT(*) FROM wallets;")
TASKS_AFTER=$(sql "SELECT COUNT(*) FROM tasks;")

# 行数一致性
if [ "$USERS_BEFORE" = "$USERS_AFTER" ]; then
  echo "  [PASS] users 行数一致 (备份前=$USERS_BEFORE, 恢复后=$USERS_AFTER)"
else
  echo "  [FAIL] users 行数不一致 (备份前=$USERS_BEFORE, 恢复后=$USERS_AFTER)"
  CONSISTENCY_PASS=false
fi

if [ "$WALLETS_BEFORE" = "$WALLETS_AFTER" ]; then
  echo "  [PASS] wallets 行数一致 (备份前=$WALLETS_BEFORE, 恢复后=$WALLETS_AFTER)"
else
  echo "  [FAIL] wallets 行数不一致 (备份前=$WALLETS_BEFORE, 恢复后=$WALLETS_AFTER)"
  CONSISTENCY_PASS=false
fi

if [ "$TASKS_BEFORE" = "$TASKS_AFTER" ]; then
  echo "  [PASS] tasks 行数一致 (备份前=$TASKS_BEFORE, 恢复后=$TASKS_AFTER)"
else
  echo "  [FAIL] tasks 行数不一致 (备份前=$TASKS_BEFORE, 恢复后=$TASKS_AFTER)"
  CONSISTENCY_PASS=false
fi

# 字段级一致性
USER_CS_AFTER=$(sql "SELECT CONCAT(id,'|',openid,'|',nickname,'|',IFNULL(phone,''),'|',credit_score,'|',role,'|',status) FROM users WHERE id=$TEST_USER_ID;" 2>/dev/null || echo "NOT_FOUND")
WALLET_CS_AFTER=$(sql "SELECT CONCAT(user_id,'|',balance,'|',frozen) FROM wallets WHERE user_id=$TEST_USER_ID;" 2>/dev/null || echo "NOT_FOUND")
TASK_CS_AFTER=$(sql "SELECT CONCAT(id,'|',title,'|',price,'|',view_count,'|',status) FROM tasks WHERE id=$TEST_TASK_ID;" 2>/dev/null || echo "NOT_FOUND")

if [ "$USER_CS_BEFORE" = "$USER_CS_AFTER" ]; then
  echo "  [PASS] 测试用户字段一致"
  echo "        $USER_CS_BEFORE"
else
  echo "  [FAIL] 测试用户字段不一致"
  echo "        备份前: $USER_CS_BEFORE"
  echo "        恢复后: $USER_CS_AFTER"
  CONSISTENCY_PASS=false
fi

if [ "$WALLET_CS_BEFORE" = "$WALLET_CS_AFTER" ]; then
  echo "  [PASS] 测试钱包字段一致"
  echo "        $WALLET_CS_BEFORE"
else
  echo "  [FAIL] 测试钱包字段不一致"
  echo "        备份前: $WALLET_CS_BEFORE"
  echo "        恢复后: $WALLET_CS_AFTER"
  CONSISTENCY_PASS=false
fi

if [ "$TASK_CS_BEFORE" = "$TASK_CS_AFTER" ]; then
  echo "  [PASS] 测试任务字段一致"
  echo "        $TASK_CS_BEFORE"
else
  echo "  [FAIL] 测试任务字段不一致"
  echo "        备份前: $TASK_CS_BEFORE"
  echo "        恢复后: $TASK_CS_AFTER"
  CONSISTENCY_PASS=false
fi
echo ""

# ---------- 8. 清理测试数据 ----------
echo "========== 阶段 8: 清理测试数据 =========="
sql "DELETE FROM tasks WHERE id=$TEST_TASK_ID;" 2>/dev/null || true
sql "DELETE FROM wallets WHERE user_id=$TEST_USER_ID;" 2>/dev/null || true
sql "DELETE FROM users WHERE id=$TEST_USER_ID;" 2>/dev/null || true
echo "  测试数据已清理"
echo ""

# ---------- 9. 汇总 ----------
DRILL_END=$(date +%s)
DRILL_TOTAL=$((DRILL_END - DRILL_START))

echo "============================================================"
echo "  演练汇总"
echo "============================================================"
echo "  演练时间: $DRILL_DATE"
echo "  总耗时: ${DRILL_TOTAL}s"
echo "  数据准备: ${T1_MS}ms"
echo "  全量备份: ${T3_SEC}s"
echo "  数据删除: ${T5_MS}ms"
echo "  数据恢复: ${T6_SEC}s"
echo "  备份文件: $BACKUP_NAME (${BACKUP_SIZE} 字节)"
echo "  数据库大小: ${DB_SIZE} KB"
echo "  完整性校验: $(if $INTEGRITY_PASS; then echo '全部通过'; else echo '存在失败'; fi)"
echo "  一致性校验: $(if $CONSISTENCY_PASS; then echo '全部通过'; else echo '存在失败'; fi)"
echo "============================================================"
