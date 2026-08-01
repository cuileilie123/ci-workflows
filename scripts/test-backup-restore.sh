#!/bin/bash
# ============================================================
# 测试脚本：验证备份和恢复脚本的完整流程
# ============================================================
# 测试流程：
#   1. 准备测试数据（插入 users/wallets/tasks 等记录）
#   2. 记录备份前数据特征（行数、校验和）
#   3. 执行 backup.sh
#   4. 验证备份文件生成 + 完整性
#   5. 模拟数据丢失（DELETE 测试数据）
#   6. 执行 restore.sh 恢复
#   7. 验证数据一致性（行数、校验和比对）
#   8. 清理测试数据
#   9. 输出测试报告
# ============================================================

set -euo pipefail

# ---------- 配置 ----------
MYSQL_HOST="${MYSQL_HOST:-mysql}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-root123}"
MYSQL_DATABASE="${MYSQL_DATABASE:-neighborhood_help}"
BACKUP_DIR="/backup/mysql"
TEST_TAG="backup_test_$(date +%s)"
REPORT_FILE="/tmp/test_report_${TEST_TAG}.txt"
PASS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0

# ---------- 工具函数 ----------
log_info()  { echo -e "\033[34m[INFO]\033[0m  $*"; }
log_pass()  { echo -e "\033[32m[PASS]\033[0m  $*"; PASS_COUNT=$((PASS_COUNT+1)); TOTAL_COUNT=$((TOTAL_COUNT+1)); }
log_fail()  { echo -e "\033[31m[FAIL]\033[0m  $*"; FAIL_COUNT=$((FAIL_COUNT+1)); TOTAL_COUNT=$((TOTAL_COUNT+1)); }
log_step()  { echo -e "\033[35m[STEP]\033[0m  $*"; }
log_warn()  { echo -e "\033[33m[WARN]\033[0m  $*"; }

# 执行 SQL（静默）
sql() {
  mysql -h"$MYSQL_HOST" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" \
    -N -e "$1" 2>/dev/null
}

# 断言函数
assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    log_pass "$desc (期望=$expected, 实际=$actual)"
  else
    log_fail "$desc (期望=$expected, 实际=$actual)"
  fi
}

assert_gt() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" -gt "$expected" ]; then
    log_pass "$desc (期望>$expected, 实际=$actual)"
  else
    log_fail "$desc (期望>$expected, 实际=$actual)"
  fi
}

assert_file_exists() {
  local desc="$1" file="$2"
  if [ -f "$file" ]; then
    log_pass "$desc: 文件存在 $file"
  else
    log_fail "$desc: 文件不存在 $file"
  fi
}

# ---------- 开始报告 ----------
{
  echo "=========================================="
  echo "  备份/恢复脚本测试报告"
  echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "  测试标签: $TEST_TAG"
  echo "  数据库: $MYSQL_DATABASE@$MYSQL_HOST"
  echo "=========================================="
  echo ""
} | tee "$REPORT_FILE"

log_step "【步骤 1/9】准备测试数据"

# 插入测试用户
TEST_USER_OPENID="${TEST_TAG}_openid"
TEST_USER_NICKNAME="测试用户_${TEST_TAG}"

if sql "INSERT INTO users (openid, nickname, phone, credit_score, role, status, updated_at)
       VALUES ('$TEST_USER_OPENID', '$TEST_USER_NICKNAME', '13800000000', 100, 'USER', 'ACTIVE', NOW(3));"; then
  log_info "已插入测试用户: $TEST_USER_NICKNAME"
else
  log_fail "插入测试用户失败"
  exit 1
fi

# 获取测试用户 ID
TEST_USER_ID=$(sql "SELECT id FROM users WHERE openid='$TEST_USER_OPENID';")
log_info "测试用户 ID: $TEST_USER_ID"

# 插入测试钱包
if sql "INSERT INTO wallets (user_id, balance, frozen, updated_at)
       VALUES ($TEST_USER_ID, 99.99, 0, NOW(3));"; then
  log_info "已插入测试钱包 (balance=99.99)"
else
  log_fail "插入测试钱包失败"
fi

# 插入测试任务
if sql "INSERT INTO tasks (publisher_id, title, description, price, lat, lng, geohash, address, category, images, status, expire_at, view_count, updated_at)
       VALUES ($TEST_USER_ID, '测试任务_${TEST_TAG}', '用于备份测试的任务', 50.00, 39.9042000, 116.4074000, 'wx4g0', '北京市朝阳区', 'DELIVERY', '[]', 'OPEN', DATE_ADD(NOW(), INTERVAL 7 DAY), 10, NOW(3));"; then
  log_info "已插入测试任务"
else
  log_fail "插入测试任务失败"
fi

# 获取测试任务 ID
TEST_TASK_ID=$(sql "SELECT id FROM tasks WHERE title='测试任务_${TEST_TAG}';")
log_info "测试任务 ID: $TEST_TASK_ID"

# ---------- 步骤 2: 记录备份前数据特征 ----------
log_step "【步骤 2/9】记录备份前数据特征"

USERS_COUNT_BEFORE=$(sql "SELECT COUNT(*) FROM users;")
WALLETS_COUNT_BEFORE=$(sql "SELECT COUNT(*) FROM wallets;")
TASKS_COUNT_BEFORE=$(sql "SELECT COUNT(*) FROM tasks;")
TEST_USER_CHECKSUM_BEFORE=$(sql "SELECT CONCAT(id,'|',openid,'|',nickname,'|',IFNULL(phone,''),'|',credit_score) FROM users WHERE id=$TEST_USER_ID;")
TEST_WALLET_CHECKSUM_BEFORE=$(sql "SELECT CONCAT(user_id,'|',balance,'|',frozen) FROM wallets WHERE user_id=$TEST_USER_ID;")
TEST_TASK_CHECKSUM_BEFORE=$(sql "SELECT CONCAT(id,'|',title,'|',price,'|',view_count) FROM tasks WHERE id=$TEST_TASK_ID;")

log_info "备份前 users 总数: $USERS_COUNT_BEFORE"
log_info "备份前 wallets 总数: $WALLETS_COUNT_BEFORE"
log_info "备份前 tasks 总数: $TASKS_COUNT_BEFORE"
log_info "测试用户特征: $TEST_USER_CHECKSUM_BEFORE"
log_info "测试钱包特征: $TEST_WALLET_CHECKSUM_BEFORE"
log_info "测试任务特征: $TEST_TASK_CHECKSUM_BEFORE"

# ---------- 步骤 3: 执行 backup.sh ----------
log_step "【步骤 3/9】执行 backup.sh"

BACKUP_START_TIME=$(date +%s)
if bash /scripts/backup.sh >> "$REPORT_FILE" 2>&1; then
  BACKUP_END_TIME=$(date +%s)
  BACKUP_DURATION=$((BACKUP_END_TIME - BACKUP_START_TIME))
  log_pass "backup.sh 执行成功 (耗时 ${BACKUP_DURATION}s)"
else
  log_fail "backup.sh 执行失败"
  exit 1
fi

# ---------- 步骤 4: 验证备份文件 ----------
log_step "【步骤 4/9】验证备份文件"

# 找到最新的备份文件
LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/full_*.sql.gz 2>/dev/null | head -1)
log_info "最新备份文件: $LATEST_BACKUP"

assert_file_exists "备份文件生成" "$LATEST_BACKUP"

# 文件大小 > 0
BACKUP_SIZE=$(stat -c%s "$LATEST_BACKUP" 2>/dev/null || stat -f%z "$LATEST_BACKUP" 2>/dev/null || echo 0)
assert_gt "备份文件大小" 0 "$BACKUP_SIZE"
log_info "备份文件大小: ${BACKUP_SIZE} 字节"

# 完整性校验：末尾包含 "Dump completed"
if gunzip -c "$LATEST_BACKUP" 2>/dev/null | tail -5 | grep -q "Dump completed"; then
  log_pass "备份文件完整性校验通过 (Dump completed)"
else
  log_fail "备份文件完整性校验失败"
fi

# 完整性校验：开头包含 dump header（兼容 MySQL 和 MariaDB，临时关闭 pipefail）
set +o pipefail
if gunzip -c "$LATEST_BACKUP" 2>/dev/null | head -10 | grep -qE "(MySQL|MariaDB) dump"; then
  log_pass "备份文件格式校验通过 (dump header)"
else
  log_fail "备份文件格式校验失败"
fi
set -o pipefail

# 验证备份内容包含测试数据（用 ASCII 标识，因 mysqldump 可能将中文编码为字节序列）
if gunzip -c "$LATEST_BACKUP" 2>/dev/null | grep -q "$TEST_USER_OPENID"; then
  log_pass "备份包含测试用户数据 ($TEST_USER_OPENID)"
else
  log_fail "备份未包含测试用户数据"
fi

# 用 ASCII 标签验证测试任务（中文字符在 mysqldump 中可能被编码）
if gunzip -c "$LATEST_BACKUP" 2>/dev/null | grep -q "$TEST_TAG"; then
  log_pass "备份包含测试任务数据 (通过标签 $TEST_TAG)"
else
  log_fail "备份未包含测试任务数据"
fi

# 验证备份日志已记录
if [ -f "$BACKUP_DIR/backup_log.csv" ]; then
  if grep -q "$LATEST_BACKUP" "$BACKUP_DIR/backup_log.csv" 2>/dev/null || \
     grep -q "$(basename "$LATEST_BACKUP")" "$BACKUP_DIR/backup_log.csv" 2>/dev/null; then
    log_pass "备份日志已记录到 backup_log.csv"
  else
    log_warn "备份日志未找到本次记录（可能文件名不匹配）"
  fi
else
  log_warn "backup_log.csv 不存在"
fi

# ---------- 步骤 5: 模拟数据丢失 ----------
log_step "【步骤 5/9】模拟数据丢失"

# 删除测试任务
sql "DELETE FROM tasks WHERE id=$TEST_TASK_ID;" && log_info "已删除测试任务" || log_fail "删除测试任务失败"

# 删除测试钱包
sql "DELETE FROM wallets WHERE user_id=$TEST_USER_ID;" && log_info "已删除测试钱包" || log_fail "删除测试钱包失败"

# 删除测试用户
sql "DELETE FROM users WHERE id=$TEST_USER_ID;" && log_info "已删除测试用户" || log_fail "删除测试用户失败"

# 验证数据已删除
USERS_COUNT_AFTER_DELETE=$(sql "SELECT COUNT(*) FROM users;")
WALLETS_COUNT_AFTER_DELETE=$(sql "SELECT COUNT(*) FROM wallets;")
TASKS_COUNT_AFTER_DELETE=$(sql "SELECT COUNT(*) FROM tasks;")

log_info "删除后 users 总数: $USERS_COUNT_AFTER_DELETE"
log_info "删除后 wallets 总数: $WALLETS_COUNT_AFTER_DELETE"
log_info "删除后 tasks 总数: $TASKS_COUNT_AFTER_DELETE"

assert_eq "users 删除验证" "$((USERS_COUNT_BEFORE - 1))" "$USERS_COUNT_AFTER_DELETE"
assert_eq "wallets 删除验证" "$((WALLETS_COUNT_BEFORE - 1))" "$WALLETS_COUNT_AFTER_DELETE"
assert_eq "tasks 删除验证" "$((TASKS_COUNT_BEFORE - 1))" "$TASKS_COUNT_AFTER_DELETE"

# ---------- 步骤 6: 执行恢复 ----------
log_step "【步骤 6/9】执行 restore.sh 恢复"

RESTORE_START_TIME=$(date +%s)

# 使用 echo "yes" 自动确认 restore.sh 的交互提示
if echo "yes" | bash /scripts/restore.sh "$LATEST_BACKUP" >> "$REPORT_FILE" 2>&1; then
  RESTORE_END_TIME=$(date +%s)
  RESTORE_DURATION=$((RESTORE_END_TIME - RESTORE_START_TIME))
  log_pass "restore.sh 执行成功 (耗时 ${RESTORE_DURATION}s)"
else
  RESTORE_END_TIME=$(date +%s)
  RESTORE_DURATION=$((RESTORE_END_TIME - RESTORE_START_TIME))
  log_fail "restore.sh 执行失败 (耗时 ${RESTORE_DURATION}s)"
  exit 1
fi

# ---------- 步骤 7: 验证数据一致性 ----------
log_step "【步骤 7/9】验证数据一致性"

USERS_COUNT_AFTER_RESTORE=$(sql "SELECT COUNT(*) FROM users;")
WALLETS_COUNT_AFTER_RESTORE=$(sql "SELECT COUNT(*) FROM wallets;")
TASKS_COUNT_AFTER_RESTORE=$(sql "SELECT COUNT(*) FROM tasks;")

log_info "恢复后 users 总数: $USERS_COUNT_AFTER_RESTORE"
log_info "恢复后 wallets 总数: $WALLETS_COUNT_AFTER_RESTORE"
log_info "恢复后 tasks 总数: $TASKS_COUNT_AFTER_RESTORE"

# 验证表行数一致
assert_eq "users 行数恢复一致" "$USERS_COUNT_BEFORE" "$USERS_COUNT_AFTER_RESTORE"
assert_eq "wallets 行数恢复一致" "$WALLETS_COUNT_BEFORE" "$WALLETS_COUNT_AFTER_RESTORE"
assert_eq "tasks 行数恢复一致" "$TASKS_COUNT_BEFORE" "$TASKS_COUNT_AFTER_RESTORE"

# 验证测试数据特征一致
TEST_USER_CHECKSUM_AFTER=$(sql "SELECT CONCAT(id,'|',openid,'|',nickname,'|',IFNULL(phone,''),'|',credit_score) FROM users WHERE id=$TEST_USER_ID;" 2>/dev/null || echo "NOT_FOUND")
TEST_WALLET_CHECKSUM_AFTER=$(sql "SELECT CONCAT(user_id,'|',balance,'|',frozen) FROM wallets WHERE user_id=$TEST_USER_ID;" 2>/dev/null || echo "NOT_FOUND")
TEST_TASK_CHECKSUM_AFTER=$(sql "SELECT CONCAT(id,'|',title,'|',price,'|',view_count) FROM tasks WHERE id=$TEST_TASK_ID;" 2>/dev/null || echo "NOT_FOUND")

assert_eq "测试用户数据一致" "$TEST_USER_CHECKSUM_BEFORE" "$TEST_USER_CHECKSUM_AFTER"
assert_eq "测试钱包数据一致" "$TEST_WALLET_CHECKSUM_BEFORE" "$TEST_WALLET_CHECKSUM_AFTER"
assert_eq "测试任务数据一致" "$TEST_TASK_CHECKSUM_BEFORE" "$TEST_TASK_CHECKSUM_AFTER"

log_info "恢复前用户特征: $TEST_USER_CHECKSUM_BEFORE"
log_info "恢复后用户特征: $TEST_USER_CHECKSUM_AFTER"
log_info "恢复前钱包特征: $TEST_WALLET_CHECKSUM_BEFORE"
log_info "恢复后钱包特征: $TEST_WALLET_CHECKSUM_AFTER"
log_info "恢复前任务特征: $TEST_TASK_CHECKSUM_BEFORE"
log_info "恢复后任务特征: $TEST_TASK_CHECKSUM_AFTER"

# ---------- 步骤 8: 清理测试数据 ----------
log_step "【步骤 8/9】清理测试数据"

# 按依赖顺序删除
sql "DELETE FROM tasks WHERE id=$TEST_TASK_ID;" 2>/dev/null && log_info "已清理测试任务" || log_warn "清理测试任务时警告"
sql "DELETE FROM wallets WHERE user_id=$TEST_USER_ID;" 2>/dev/null && log_info "已清理测试钱包" || log_warn "清理测试钱包时警告"
sql "DELETE FROM users WHERE id=$TEST_USER_ID;" 2>/dev/null && log_info "已清理测试用户" || log_warn "清理测试用户时警告"

# 清理临时报告文件
rm -f /tmp/pre_restore_*.sql.gz 2>/dev/null || true
log_info "已清理临时文件"

# ---------- 步骤 9: 输出测试报告 ----------
log_step "【步骤 9/9】测试报告汇总"

{
  echo ""
  echo "=========================================="
  echo "  测试结果汇总"
  echo "=========================================="
  echo "  总测试项: $TOTAL_COUNT"
  echo "  通过: $PASS_COUNT"
  echo "  失败: $FAIL_COUNT"
  if [ $TOTAL_COUNT -gt 0 ]; then
    PASS_RATE=$(awk "BEGIN {printf \"%.1f\", $PASS_COUNT * 100 / $TOTAL_COUNT}")
  else
    PASS_RATE="0.0"
  fi
  echo "  通过率: ${PASS_RATE}%"
  echo "=========================================="
} | tee -a "$REPORT_FILE"

if [ $FAIL_COUNT -eq 0 ]; then
  echo -e "\033[32m🎉 所有测试用例通过！备份和恢复脚本工作正常。\033[0m"
  exit 0
else
  echo -e "\033[31m❌ 有 $FAIL_COUNT 个测试用例失败，请检查上述日志。\033[0m"
  exit 1
fi
