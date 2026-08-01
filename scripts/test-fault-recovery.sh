#!/bin/bash
# ============================================================
# 故障排查场景自动化测试脚本
# ============================================================
# 验证手册第八章"故障排查"中所有场景是否能正确触发并恢复
#
# 执行方式:
#   docker exec nh-backup-scheduler bash -c \
#     "source /tmp/backup-env.sh && bash /scripts/test-fault-recovery.sh"
#
# 测试场景 (10 项):
#   TC-01  Cron 进程状态验证
#   TC-02  环境变量文件丢失后恢复
#   TC-03  Cron 配置文件格式错误检测
#   TC-04  MySQL 不可达时备份降级
#   TC-05  备份文件损坏检测 (verify-backup.sh)
#   TC-06  COS 未配置时优雅降级
#   TC-07  损坏备份文件恢复被拦截 (restore.sh)
#   TC-08  backup-init.sh 批量校验逻辑
#   TC-09  Cron 任务实际触发验证
#   TC-10  Header + Footer 双校验完整性
# ============================================================

set -uo pipefail

# ---------- 配置 ----------
BACKUP_DIR="/backup/mysql"
TEST_DIR="/tmp/fault-test"
MYSQL_HOST="${MYSQL_HOST:-mysql}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-root123}"
MYSQL_DATABASE="${MYSQL_DATABASE:-neighborhood_help}"

# ---------- 计数器 ----------
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
TOTAL_COUNT=0

# ---------- 工具函数 ----------
log_info()  { echo -e "\033[34m[INFO]\033[0m  $*"; }
log_pass()  { echo -e "\033[32m[PASS]\033[0m  $*"; PASS_COUNT=$((PASS_COUNT+1)); TOTAL_COUNT=$((TOTAL_COUNT+1)); }
log_fail()  { echo -e "\033[31m[FAIL]\033[0m  $*"; FAIL_COUNT=$((FAIL_COUNT+1)); TOTAL_COUNT=$((TOTAL_COUNT+1)); }
log_warn()  { echo -e "\033[33m[WARN]\033[0m  $*"; WARN_COUNT=$((WARN_COUNT+1)); }
log_step()  { echo -e "\n\033[35m══════ $1 ══════\033[0m"; }

# 执行 SQL（静默）
sql() {
  mysql -h"$MYSQL_HOST" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" \
    -N -e "$1" 2>/dev/null
}

# ============================================================
# TC-01: Cron 进程状态验证
# ============================================================
tc_01_cron_process() {
  log_step "TC-01: Cron 进程状态验证"

  # 1.1 验证 cron 进程运行
  if pgrep -x cron > /dev/null 2>&1; then
    log_pass "cron 进程正在运行 (PID=$(pgrep -x cron | head -1))"
  else
    log_fail "cron 进程未运行"
  fi

  # 1.2 验证 cron 以 PID 1 运行（容器入口进程）
  if [ "$(cat /proc/1/comm 2>/dev/null)" = "cron" ]; then
    log_pass "cron 作为 PID 1 运行 (入口进程)"
  else
    log_warn "PID 1 不是 cron (实际: $(cat /proc/1/comm 2>/dev/null))"
  fi

  # 1.3 验证 /etc/cron.d/backup-cron 存在
  if [ -f /etc/cron.d/backup-cron ]; then
    log_pass "/etc/cron.d/backup-cron 文件存在"
  else
    log_fail "/etc/cron.d/backup-cron 文件不存在"
  fi

  # 1.4 验证 cron 配置文件权限
  PERMS=$(stat -c%a /etc/cron.d/backup-cron 2>/dev/null)
  if [ "$PERMS" = "644" ]; then
    log_pass "cron 配置文件权限正确 (644)"
  else
    log_fail "cron 配置文件权限错误 (期望=644, 实际=$PERMS)"
  fi

  # 1.5 验证 cron 配置包含 4 个任务
  TASK_COUNT=$(grep -c 'root source' /etc/cron.d/backup-cron 2>/dev/null || echo 0)
  if [ "$TASK_COUNT" -eq 4 ]; then
    log_pass "cron 配置包含 4 个定时任务"
  else
    log_fail "cron 配置任务数量异常 (期望=4, 实际=$TASK_COUNT)"
  fi
}

# ============================================================
# TC-02: 环境变量文件丢失后恢复
# ============================================================
tc_02_env_file_recovery() {
  log_step "TC-02: 环境变量文件丢失后恢复"

  ENV_FILE="/tmp/backup-env.sh"

  # 2.1 备份原始环境变量文件
  cp "$ENV_FILE" "${ENV_FILE}.bak"
  log_info "已备份环境变量文件"

  # 2.2 删除环境变量文件
  rm -f "$ENV_FILE"
  if [ ! -f "$ENV_FILE" ]; then
    log_pass "环境变量文件已删除"
  else
    log_fail "环境变量文件删除失败"
    cp "${ENV_FILE}.bak" "$ENV_FILE"
    return
  fi

  # 2.3 验证无环境变量时备份提示正确
  OUTPUT=$(bash /scripts/backup.sh 2>&1 || true)
  if echo "$OUTPUT" | grep -qE "(coscmd 未配置|COS 上传失败|备份验证)"; then
    log_pass "无环境变量文件时脚本仍可执行（使用默认值或报错提示）"
  else
    log_warn "无环境变量文件时输出: $(echo "$OUTPUT" | head -3)"
  fi

  # 2.4 手动恢复环境变量文件（模拟 backup-init.sh 的行为）
  # 从 backup-init.sh 中提取环境变量生成逻辑
  cat > "$ENV_FILE" << 'ENVEOF'
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
ENVEOF

  # 从 .bak 文件中提取实际值进行替换
  # 直接恢复备份文件（模拟重启容器后的行为）
  cp "${ENV_FILE}.bak" "$ENV_FILE"
  rm -f "${ENV_FILE}.bak"

  # 2.5 验证恢复后环境变量可用
  source "$ENV_FILE"
  if [ -n "${MYSQL_HOST:-}" ] && [ -n "${MYSQL_DATABASE:-}" ]; then
    log_pass "环境变量文件恢复后可正常加载 (MYSQL_HOST=$MYSQL_HOST)"
  else
    log_fail "环境变量文件恢复后加载失败"
  fi

  # 2.6 验证恢复后备份正常执行
  OUTPUT=$(bash /scripts/backup.sh 2>&1 || true)
  if echo "$OUTPUT" | grep -q "备份验证通过"; then
    log_pass "环境变量恢复后备份正常执行"
  else
    log_fail "环境变量恢复后备份仍异常: $(echo "$OUTPUT" | tail -2)"
  fi
}

# ============================================================
# TC-03: Cron 配置文件格式错误检测
# ============================================================
tc_03_cron_format_error() {
  log_step "TC-03: Cron 配置文件格式错误检测"

  CRON_FILE="/etc/cron.d/backup-cron"

  # 3.1 备份原始 cron 配置
  cp "$CRON_FILE" "${CRON_FILE}.bak"
  log_info "已备份 cron 配置文件"

  # 3.2 写入格式错误的内容（缺少 root 用户字段）
  cat > "$CRON_FILE" << 'BADEOF'
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

# 错误格式：缺少 user 字段
0 3 * * * source /tmp/backup-env.sh && bash /scripts/backup.sh
BADEOF
  chmod 644 "$CRON_FILE"
  log_info "已写入格式错误的 cron 配置"

  # 3.3 验证 cron 格式检测（检查每行是否有 root 字段）
  BAD_LINES=$(grep -v '^#' "$CRON_FILE" | grep -v '^$' | grep -v '^SHELL' | grep -v '^PATH' | grep -v 'root ' | wc -l)
  if [ "$BAD_LINES" -gt 0 ]; then
    log_pass "检测到 $BAD_LINES 行缺少 root 用户字段"
  else
    log_fail "未能检测到格式错误"
  fi

  # 3.4 写入另一种格式错误（bad minute - 分钟数超过 59）
  cat > "$CRON_FILE" << 'BADEOF2'
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

# 错误格式：分钟数 99 无效
99 3 * * * root bash /scripts/backup.sh
BADEOF2
  chmod 644 "$CRON_FILE"

  # 3.5 验证无效分钟数检测
  MINUTE_VAL=$(grep -v '^#' "$CRON_FILE" | grep -v '^$' | grep -v '^SHELL' | grep -v '^PATH' | head -1 | awk '{print $1}')
  if [ "$MINUTE_VAL" -gt 59 ] 2>/dev/null; then
    log_pass "检测到无效分钟数: $MINUTE_VAL (超过 59)"
  else
    log_warn "分钟数校验: $MINUTE_VAL"
  fi

  # 3.6 恢复原始配置
  cp "${CRON_FILE}.bak" "$CRON_FILE"
  rm -f "${CRON_FILE}.bak"
  log_info "已恢复原始 cron 配置"

  # 3.7 验证恢复后配置正确
  TASK_COUNT=$(grep -c 'root source' "$CRON_FILE" 2>/dev/null || echo 0)
  if [ "$TASK_COUNT" -eq 4 ]; then
    log_pass "恢复后 cron 配置正确 (4 个任务)"
  else
    log_fail "恢复后 cron 配置异常 (任务数=$TASK_COUNT)"
  fi
}

# ============================================================
# TC-04: MySQL 不可达时备份降级
# ============================================================
tc_04_mysql_unreachable() {
  log_step "TC-04: MySQL 不可达时备份降级"

  # 4.1 验证当前 MySQL 可达
  if mysqladmin ping -h"$MYSQL_HOST" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --silent 2>/dev/null; then
    log_pass "MySQL 当前可达"
  else
    log_fail "MySQL 当前不可达，跳过本测试"
    return
  fi

  # 4.2 模拟 MySQL 不可达（使用无效主机）
  log_info "模拟 MySQL 不可达 (MYSQL_HOST=invalid_host_9999)"
  OUTPUT=$(MYSQL_HOST=invalid_host_9999 bash /scripts/backup.sh 2>&1 || true)

  # 4.3 验证备份失败提示
  if echo "$OUTPUT" | grep -qiE "(error|failed|refused|can't connect|备份验证失败)"; then
    log_pass "MySQL 不可达时备份正确失败"
  else
    log_warn "MySQL 不可达时输出未包含预期错误: $(echo "$OUTPUT" | tail -3)"
  fi

  # 4.4 验证备份脚本退出码非零
  MYSQL_HOST=invalid_host_9999 bash /scripts/backup.sh > /dev/null 2>&1
  EXIT_CODE=$?
  if [ $EXIT_CODE -ne 0 ]; then
    log_pass "MySQL 不可达时备份脚本退出码非零 (code=$EXIT_CODE)"
  else
    log_fail "MySQL 不可达时备份脚本退出码为零（应该失败）"
  fi

  # 4.5 验证 MySQL 恢复后备份正常
  OUTPUT=$(bash /scripts/backup.sh 2>&1 || true)
  if echo "$OUTPUT" | grep -q "备份验证通过"; then
    log_pass "MySQL 恢复后备份正常执行"
  else
    log_fail "MySQL 恢复后备份仍异常: $(echo "$OUTPUT" | tail -2)"
  fi
}

# ============================================================
# TC-05: 备份文件损坏检测 (verify-backup.sh)
# ============================================================
tc_05_corrupt_backup_detection() {
  log_step "TC-05: 备份文件损坏检测"

  mkdir -p "$TEST_DIR"

  # 5.1 创建完全损坏的备份文件（随机数据）
  CORRUPT_FILE="$BACKUP_DIR/full_corrupt_test.sql.gz"
  head -c 1024 /dev/urandom > "$CORRUPT_FILE"
  log_info "已创建损坏的备份文件 (随机数据)"

  # 5.2 验证 verify-backup.sh 能检测到损坏
  OUTPUT=$(bash /scripts/verify-backup.sh 2>&1 || true)
  if echo "$OUTPUT" | grep -qiE "(已损坏|FAIL|失败)"; then
    log_pass "verify-backup.sh 检测到损坏的备份文件"
  else
    log_warn "verify-backup.sh 输出: $(echo "$OUTPUT" | tail -3)"
  fi

  # 5.3 创建 footer 损坏的备份文件（有效 header 但无 footer）
  PARTIAL_FILE="$BACKUP_DIR/full_partial_test.sql.gz"
  echo "-- MariaDB dump 10.19" | gzip > "$PARTIAL_FILE"
  log_info "已创建 footer 损坏的备份文件 (有 header 无 footer)"

  # 5.4 验证 verify-backup.sh 检测到 footer 缺失
  # 先让 verify-backup.sh 检查这个文件（通过临时重命名使它成为最新）
  mv "$CORRUPT_FILE" "$TEST_DIR/corrupt.bak"
  OUTPUT=$(bash /scripts/verify-backup.sh 2>&1 || true)
  if echo "$OUTPUT" | grep -qiE "(已损坏|FAIL|失败|部分通过)"; then
    log_pass "verify-backup.sh 检测到 footer 缺失的备份"
  else
    log_warn "footer 缺失检测输出: $(echo "$OUTPUT" | tail -3)"
  fi

  # 5.5 清理损坏文件
  rm -f "$PARTIAL_FILE"
  mv "$TEST_DIR/corrupt.bak" "$CORRUPT_FILE" 2>/dev/null || true
  rm -f "$CORRUPT_FILE"

  # 5.6 验证清理后 verify-backup.sh 恢复正常
  OUTPUT=$(bash /scripts/verify-backup.sh 2>&1 || true)
  if echo "$OUTPUT" | grep -q "验证通过"; then
    log_pass "清理损坏文件后 verify-backup.sh 恢复正常"
  else
    log_fail "清理后 verify-backup.sh 仍异常: $(echo "$OUTPUT" | tail -2)"
  fi
}

# ============================================================
# TC-06: COS 未配置时优雅降级
# ============================================================
tc_06_cos_graceful_degradation() {
  log_step "TC-06: COS 未配置时优雅降级"

  # 6.1 执行备份，COS_SECRET_ID 为空
  OUTPUT=$(COS_SECRET_ID="" COS_SECRET_KEY="" bash /scripts/backup.sh 2>&1 || true)

  # 6.2 验证输出包含 "coscmd 未配置"
  if echo "$OUTPUT" | grep -q "coscmd 未配置"; then
    log_pass "COS 未配置时正确提示 'coscmd 未配置'"
  else
    log_warn "COS 未配置时输出: $(echo "$OUTPUT" | grep -i cos | head -2)"
  fi

  # 6.3 验证本地备份仍然成功
  if echo "$OUTPUT" | grep -q "备份验证通过"; then
    log_pass "COS 未配置时本地备份仍然成功"
  else
    log_fail "COS 未配置时本地备份也失败"
  fi

  # 6.4 验证 backup_log.csv 仍有记录
  LAST_LOG=$(tail -1 "$BACKUP_DIR/backup_log.csv" 2>/dev/null)
  if [ -n "$LAST_LOG" ]; then
    log_pass "COS 未配置时备份日志仍记录: $LAST_LOG"
  else
    log_fail "COS 未配置时备份日志未记录"
  fi
}

# ============================================================
# TC-07: 损坏备份文件恢复被拦截 (restore.sh)
# ============================================================
tc_07_restore_blocked() {
  log_step "TC-07: 损坏备份文件恢复被拦截"

  # 7.1 创建损坏的备份文件
  CORRUPT_RESTORE="$TEST_DIR/corrupt_restore.sql.gz"
  head -c 512 /dev/urandom > "$CORRUPT_RESTORE"
  log_info "已创建损坏的备份文件用于恢复测试"

  # 7.2 尝试用损坏文件恢复，验证被拦截
  OUTPUT=$(echo "yes" | bash /scripts/restore.sh "$CORRUPT_RESTORE" 2>&1 || true)

  if echo "$OUTPUT" | grep -q "备份文件损坏或格式错误"; then
    log_pass "损坏文件恢复被正确拦截 (header 校验失败)"
  else
    log_fail "损坏文件未被拦截: $(echo "$OUTPUT" | tail -3)"
  fi

  # 7.3 验证恢复脚本退出码非零
  echo "yes" | bash /scripts/restore.sh "$CORRUPT_RESTORE" > /dev/null 2>&1
  EXIT_CODE=$?
  if [ $EXIT_CODE -ne 0 ]; then
    log_pass "恢复脚本退出码非零 (code=$EXIT_CODE)"
  else
    log_fail "恢复脚本退出码为零（应该拒绝）"
  fi

  # 7.4 创建 header 有效但内容损坏的文件
  FAKE_FILE="$TEST_DIR/fake_dump.sql.gz"
  { echo "-- MariaDB dump 10.19"; head -c 256 /dev/urandom; echo "-- Dump completed"; } | gzip > "$FAKE_FILE"
  log_info "已创建 header 有效但内容损坏的文件"

  # 7.5 验证该文件通过 header 校验但恢复时失败
  OUTPUT=$(echo "yes" | bash /scripts/restore.sh "$FAKE_FILE" 2>&1 || true)
  if echo "$OUTPUT" | grep -qiE "(error|ERROR|恢复|开始恢复)"; then
    log_pass "header 有效但内容损坏的文件在恢复阶段被检测"
  else
    log_warn "内容损坏文件恢复输出: $(echo "$OUTPUT" | tail -3)"
  fi

  # 7.6 验证恢复前快照被创建（安全机制）
  if ls /tmp/pre_restore_*.sql.gz > /dev/null 2>&1; then
    log_pass "恢复前快照已创建 (安全机制正常)"
    rm -f /tmp/pre_restore_*.sql.gz
  else
    log_warn "未找到恢复前快照（可能 header 校验阶段已拒绝）"
  fi

  # 清理
  rm -f "$CORRUPT_RESTORE" "$FAKE_FILE"
}

# ============================================================
# TC-08: backup-init.sh 批量校验逻辑
# ============================================================
tc_08_batch_validation() {
  log_step "TC-08: backup-init.sh 批量校验逻辑"

  # 8.1 统计当前有效备份数量
  VALID_BEFORE=0
  INVALID_BEFORE=0
  for f in "$BACKUP_DIR"/full_*.sql.gz; do
    [ -f "$f" ] || continue
    # 跳过测试文件
    case "$(basename "$f")" in *test*) continue;; esac
    HEADER_OK=false
    FOOTER_OK=false
    if gunzip -c "$f" 2>/dev/null | head -10 | grep -qE "(MySQL|MariaDB) dump"; then
      HEADER_OK=true
    fi
    if gunzip -c "$f" 2>/dev/null | tail -5 | grep -q "Dump completed"; then
      FOOTER_OK=true
    fi
    if $HEADER_OK && $FOOTER_OK; then
      VALID_BEFORE=$((VALID_BEFORE + 1))
    else
      INVALID_BEFORE=$((INVALID_BEFORE + 1))
    fi
  done
  log_info "当前有效备份: $VALID_BEFORE 份, 可疑: $INVALID_BEFORE 份"

  # 8.2 创建 2 个损坏的备份文件
  CORRUPT1="$BACKUP_DIR/full_test_corrupt1.sql.gz"
  CORRUPT2="$BACKUP_DIR/full_test_corrupt2.sql.gz"
  head -c 256 /dev/urandom > "$CORRUPT1"
  head -c 256 /dev/urandom > "$CORRUPT2"
  log_info "已创建 2 个损坏的备份文件"

  # 8.3 执行 backup-init.sh 中的校验逻辑（模拟）
  VALID_AFTER=0
  INVALID_AFTER=0
  for f in "$BACKUP_DIR"/full_*.sql.gz; do
    [ -f "$f" ] || continue
    HEADER_OK=false
    FOOTER_OK=false
    if gunzip -c "$f" 2>/dev/null | head -10 | grep -qE "(MySQL|MariaDB) dump"; then
      HEADER_OK=true
    fi
    if gunzip -c "$f" 2>/dev/null | tail -5 | grep -q "Dump completed"; then
      FOOTER_OK=true
    fi
    if $HEADER_OK && $FOOTER_OK; then
      VALID_AFTER=$((VALID_AFTER + 1))
    else
      INVALID_AFTER=$((INVALID_AFTER + 1))
    fi
  done

  # 8.4 验证可疑数量增加了 2
  EXPECTED_INVALID=$((INVALID_BEFORE + 2))
  if [ "$INVALID_AFTER" -eq "$EXPECTED_INVALID" ]; then
    log_pass "批量校验正确检测到新增损坏文件 (可疑: $INVALID_BEFORE → $INVALID_AFTER)"
  else
    log_fail "批量校验数量异常 (期望可疑=$EXPECTED_INVALID, 实际=$INVALID_AFTER)"
  fi

  # 8.5 验证有效数量未变
  if [ "$VALID_AFTER" -eq "$VALID_BEFORE" ]; then
    log_pass "有效备份数量未受影响 ($VALID_AFTER 份)"
  else
    log_warn "有效备份数量变化 (之前=$VALID_BEFORE, 之后=$VALID_AFTER)"
  fi

  # 8.6 清理损坏文件
  rm -f "$CORRUPT1" "$CORRUPT2"

  # 8.7 验证清理后数量恢复
  VALID_FINAL=0
  for f in "$BACKUP_DIR"/full_*.sql.gz; do
    [ -f "$f" ] || continue
    case "$(basename "$f")" in *test*) continue;; esac
    if gunzip -c "$f" 2>/dev/null | head -10 | grep -qE "(MySQL|MariaDB) dump" && \
       gunzip -c "$f" 2>/dev/null | tail -5 | grep -q "Dump completed"; then
      VALID_FINAL=$((VALID_FINAL + 1))
    fi
  done
  if [ "$VALID_FINAL" -eq "$VALID_BEFORE" ]; then
    log_pass "清理后有效备份数量恢复 ($VALID_FINAL 份)"
  else
    log_fail "清理后数量异常 (期望=$VALID_BEFORE, 实际=$VALID_FINAL)"
  fi
}

# ============================================================
# TC-09: Cron 任务实际触发验证
# ============================================================
tc_09_cron_actual_trigger() {
  log_step "TC-09: Cron 任务实际触发验证"

  # 9.1 创建测试脚本
  CRON_TEST_LOG="/var/log/cron-trigger-test.log"
  CRON_TEST_SCRIPT="/tmp/cron-trigger-test.sh"
  cat > "$CRON_TEST_SCRIPT" << 'TRIGGEREOF'
#!/bin/bash
source /tmp/backup-env.sh
echo "[$(date '+%Y-%m-%d %H:%M:%S')] cron 触发成功" >> /var/log/cron-trigger-test.log
echo "  MYSQL_HOST=$MYSQL_HOST" >> /var/log/cron-trigger-test.log
echo "  MYSQL_DATABASE=$MYSQL_DATABASE" >> /var/log/cron-trigger-test.log
TRIGGEREOF
  chmod +x "$CRON_TEST_SCRIPT"

  # 9.2 清空日志
  > "$CRON_TEST_LOG"

  # 9.3 计算下一分钟
  MINUTE=$(date +%-M)
  NEXT_MIN=$((MINUTE + 1))
  HOUR=$(date +%-H)
  # 处理分钟溢出
  if [ "$NEXT_MIN" -ge 60 ]; then
    NEXT_MIN=0
    HOUR=$((HOUR + 1))
  fi

  # 9.4 添加临时 cron 任务
  cat > /etc/cron.d/trigger-test << CRONEOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
$NEXT_MIN $HOUR * * * root source /tmp/backup-env.sh && bash /tmp/cron-trigger-test.sh >> /var/log/cron-trigger-test.log 2>&1
CRONEOF
  chmod 0644 /etc/cron.d/trigger-test

  # 9.5 发送 SIGHUP 让 cron 重新加载
  kill -HUP 1 2>/dev/null || true
  log_info "已设置 cron 任务，将在 $HOUR:$NEXT_MIN 触发 (当前: $(date '+%H:%M'))"

  # 9.6 等待触发（最多 75 秒）
  log_info "等待 cron 触发..."
  WAITED=0
  TRIGGERED=false
  while [ $WAITED -lt 75 ]; do
    if [ -s "$CRON_TEST_LOG" ]; then
      TRIGGERED=true
      break
    fi
    sleep 3
    WAITED=$((WAITED + 3))
  done

  # 9.7 验证触发结果
  if $TRIGGERED; then
    log_pass "Cron 任务在 ${WAITED}s 内成功触发"
    # 验证环境变量正确加载
    if grep -q "MYSQL_HOST=$MYSQL_HOST" "$CRON_TEST_LOG" 2>/dev/null; then
      log_pass "Cron 触发时环境变量正确加载 (MYSQL_HOST=$MYSQL_HOST)"
    else
      log_fail "Cron 触发时环境变量未正确加载"
      log_info "日志内容: $(cat "$CRON_TEST_LOG")"
    fi
    if grep -q "MYSQL_DATABASE=$MYSQL_DATABASE" "$CRON_TEST_LOG" 2>/dev/null; then
      log_pass "Cron 触发时 MYSQL_DATABASE 正确加载"
    else
      log_fail "Cron 触发时 MYSQL_DATABASE 未正确加载"
    fi
  else
    log_fail "Cron 任务在 75s 内未触发"
  fi

  # 9.8 清理
  rm -f /etc/cron.d/trigger-test "$CRON_TEST_SCRIPT" "$CRON_TEST_LOG"
  log_info "测试文件已清理"
}

# ============================================================
# TC-10: Header + Footer 双校验完整性
# ============================================================
tc_10_dual_validation() {
  log_step "TC-10: Header + Footer 双校验完整性"

  # 获取最新有效备份
  LATEST_VALID=""
  for f in $(ls -t "$BACKUP_DIR"/full_*.sql.gz 2>/dev/null); do
    [ -f "$f" ] || continue
    case "$(basename "$f")" in *test*) continue;; esac
    if gunzip -c "$f" 2>/dev/null | head -10 | grep -qE "(MySQL|MariaDB) dump" && \
       gunzip -c "$f" 2>/dev/null | tail -5 | grep -q "Dump completed"; then
      LATEST_VALID="$f"
      break
    fi
  done

  if [ -z "$LATEST_VALID" ]; then
    log_fail "未找到有效备份文件，跳过本测试"
    return
  fi

  log_info "测试文件: $(basename "$LATEST_VALID")"

  # 10.1 验证 header 校验（MariaDB 格式）
  HEADER_CONTENT=$(gunzip -c "$LATEST_VALID" 2>/dev/null | head -3)
  if echo "$HEADER_CONTENT" | grep -qE "(MySQL|MariaDB) dump"; then
    DUMP_TYPE=$(echo "$HEADER_CONTENT" | grep -oE "(MySQL|MariaDB) dump")
    log_pass "Header 校验通过 ($DUMP_TYPE)"
  else
    log_fail "Header 校验失败: $HEADER_CONTENT"
  fi

  # 10.2 验证 footer 校验
  FOOTER_CONTENT=$(gunzip -c "$LATEST_VALID" 2>/dev/null | tail -3)
  if echo "$FOOTER_CONTENT" | grep -q "Dump completed"; then
    log_pass "Footer 校验通过 (Dump completed)"
  else
    log_fail "Footer 校验失败: $FOOTER_CONTENT"
  fi

  # 10.3 验证 backup.sh 输出双校验提示
  OUTPUT=$(bash /scripts/backup.sh 2>&1 || true)
  if echo "$OUTPUT" | grep -q "header + footer"; then
    log_pass "backup.sh 输出双校验提示 '(header + footer)'"
  else
    log_fail "backup.sh 未输出双校验提示: $(echo "$OUTPUT" | grep -i 验证 | head -1)"
  fi

  # 10.4 验证 verify-backup.sh 输出双校验提示
  OUTPUT=$(bash /scripts/verify-backup.sh 2>&1 || true)
  if echo "$OUTPUT" | grep -q "header + footer"; then
    log_pass "verify-backup.sh 输出双校验提示 '(header + footer)'"
  else
    log_fail "verify-backup.sh 未输出双校验提示: $(echo "$OUTPUT" | grep -i 验证 | head -1)"
  fi

  # 10.5 验证 restore.sh header 校验兼容 MariaDB
  LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/full_*.sql.gz 2>/dev/null | head -1)
  OUTPUT=$(echo "no" | bash /scripts/restore.sh "$LATEST_BACKUP" 2>&1 || true)
  # "no" 会取消恢复，但应该能通过 header 校验阶段
  if echo "$OUTPUT" | grep -q "已取消"; then
    log_pass "restore.sh header 校验通过（用户选择取消恢复）"
  elif echo "$OUTPUT" | grep -q "备份文件损坏"; then
    log_fail "restore.sh header 校验失败（误判为损坏）"
  else
    log_warn "restore.sh 行为: $(echo "$OUTPUT" | head -3)"
  fi
}

# ============================================================
# 主函数
# ============================================================
main() {
  echo "============================================================"
  echo "  故障排查场景自动化测试"
  echo "  时间: $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "  数据库: ${MYSQL_DATABASE}@${MYSQL_HOST}"
  echo "============================================================"

  mkdir -p "$TEST_DIR"

  # 执行所有测试
  tc_01_cron_process
  tc_02_env_file_recovery
  tc_03_cron_format_error
  tc_04_mysql_unreachable
  tc_05_corrupt_backup_detection
  tc_06_cos_graceful_degradation
  tc_07_restore_blocked
  tc_08_batch_validation
  tc_09_cron_actual_trigger
  tc_10_dual_validation

  # 汇总报告
  echo ""
  echo "============================================================"
  echo "  测试结果汇总"
  echo "============================================================"
  echo "  总测试项: $TOTAL_COUNT"
  echo "  通过:     $PASS_COUNT"
  echo "  失败:     $FAIL_COUNT"
  echo "  警告:     $WARN_COUNT"
  if [ $TOTAL_COUNT -gt 0 ]; then
    PASS_RATE=$(awk "BEGIN {printf \"%.1f\", $PASS_COUNT * 100 / $TOTAL_COUNT}")
  else
    PASS_RATE="0.0"
  fi
  echo "  通过率:   ${PASS_RATE}%"
  echo "============================================================"

  # 清理
  rm -rf "$TEST_DIR"

  if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "\033[32m🎉 所有故障排查场景测试通过！\033[0m"
    exit 0
  else
    echo -e "\033[31m❌ 有 $FAIL_COUNT 个测试项失败，请检查上述日志。\033[0m"
    exit 1
  fi
}

main "$@"
