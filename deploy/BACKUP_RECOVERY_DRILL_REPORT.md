# 备份恢复演练报告

> **演练日期**: 2026-07-31 18:36:27 CST  
> **演练环境**: 开发环境 (Docker Compose)  
> **演练结论**: ✅ 全部通过

---

## 一、演练概述

本次演练验证了社区邻里有偿互助平台的备份与恢复流程的完整性和可靠性。演练覆盖了从测试数据准备、全量备份、模拟数据丢失到数据恢复的全流程，并对恢复后的数据进行了行数级和字段级的双重一致性校验。

### 演练结果汇总

| 指标 | 数值 |
|------|------|
| 总耗时 | 47s |
| 备份耗时 | 37s |
| 恢复耗时 | 3s |
| 完整性校验 | 4/4 项通过 |
| 一致性校验 | 6/6 项通过 |
| 数据丢失 | 0 条 |

---

## 二、环境信息

### 基础环境

| 项目 | 版本/配置 |
|------|-----------|
| 操作系统 | Docker 容器 (debian:bookworm-slim) |
| MySQL 服务端 | 8.0.46 |
| MySQL 客户端 | MariaDB 10.11.18 (default-mysql-client) |
| 备份调度器镜像 | nh-backup-scheduler:latest |
| 时区 | Asia/Shanghai (CST) |

### 数据库信息

| 项目 | 值 |
|------|-----|
| 数据库名称 | neighborhood_help |
| 数据库大小 | 752.00 KB |
| 业务表数量 | 11 张 |
| 字符集 | utf8mb4 |

### 业务表清单

| 表名 | 记录数 | 大小 |
|------|--------|------|
| _prisma_migrations | 0 | 16.00 KB |
| audit_logs | 0 | 80.00 KB |
| coupons | 0 | 48.00 KB |
| orders | 0 | 96.00 KB |
| reviews | 0 | 96.00 KB |
| sensitive_words | 0 | 32.00 KB |
| tasks | 0 | 144.00 KB |
| tickets | 0 | 64.00 KB |
| transactions | 0 | 64.00 KB |
| users | 0 | 80.00 KB |
| wallets | 0 | 32.00 KB |

---

## 三、演练流程与耗时

### 流程时间线

```
18:36:27  ┬─ 演练开始
          │
18:36:28  ├─ [阶段1] 准备测试数据 ──────────── 858ms
          │   插入 users / wallets / tasks 各 1 条
          │
18:36:28  ├─ [阶段2] 记录备份前数据特征
          │   行数 + 字段校验和快照
          │
18:36:30  ├─ [阶段3] 执行全量备份 ──────────── 37s
          │   mysqldump → gzip → 完整性验证
          │
18:37:07  ├─ [阶段4] 验证备份文件完整性
          │   header / footer / 内容校验
          │
18:37:07  ├─ [阶段5] 模拟数据丢失 ──────────── 531ms
          │   DELETE users / wallets / tasks
          │
18:37:08  ├─ [阶段6] 执行数据恢复 ──────────── 3s
          │   gunzip → mysql < restore.sql
          │
18:37:11  ├─ [阶段7] 数据一致性验证
          │   行数比对 + 字段级比对
          │
18:37:14  └─ 演练结束 (总耗时 47s)
```

### 各阶段耗时明细

| 阶段 | 操作 | 耗时 | 说明 |
|------|------|------|------|
| 阶段 1 | 准备测试数据 | 858ms | 插入 3 条记录 (users + wallets + tasks) |
| 阶段 2 | 记录数据特征 | <1ms | 行数统计 + 字段校验和 |
| 阶段 3 | 全量备份 | 37s | mysqldump + gzip + 完整性自检 |
| 阶段 4 | 验证备份文件 | <1s | header/footer/内容 3 项校验 |
| 阶段 5 | 模拟数据丢失 | 531ms | DELETE 3 条记录 |
| 阶段 6 | 数据恢复 | 3s | 解压 + mysql 恢复 + 表数量验证 |
| 阶段 7 | 一致性验证 | <1s | 行数比对 + 字段级比对 |
| 阶段 8 | 清理测试数据 | <1s | 删除测试记录 |

---

## 四、备份文件详情

### 本次演练备份文件

| 属性 | 值 |
|------|-----|
| 文件名 | full_20260731_183630.sql.gz |
| 文件大小 | 3,139 字节 (3.1 KB) |
| 压缩格式 | gzip |
| 备份工具 | mysqldump (MariaDB 10.11.18) |
| 备份参数 | --single-transaction --routines --triggers --events --hex-blob --set-charset |
| 字符集 | utf8mb4 |

### 备份历史记录

| 备份时间 | 文件名 | 大小 |
|----------|--------|------|
| 17:27:25 | full_20260731_172725.sql.gz | 2.9 KB |
| 17:34:55 | full_20260731_173455.sql.gz | 2.9 KB |
| 17:58:46 | full_20260731_175846.sql.gz | 2.9 KB |
| 18:19:45 | full_20260731_181945.sql.gz | 2.9 KB |
| 18:32:53 | full_20260731_183253.sql.gz | 3.1 KB |
| **18:36:30** | **full_20260731_183630.sql.gz** | **3.1 KB** |

---

## 五、数据一致性验证

### 5.1 备份文件完整性校验（4/4 通过）

| 校验项 | 结果 | 说明 |
|--------|------|------|
| Dump completed 标记 | ✅ PASS | 文件末尾包含 "Dump completed" 标记，表示 mysqldump 正常结束 |
| Dump header 校验 | ✅ PASS | 文件头部包含 "MariaDB dump" 标识，格式正确 |
| 测试用户数据 | ✅ PASS | 备份文件中包含测试用户 openid |
| 测试任务数据 | ✅ PASS | 备份文件中包含测试任务标签 |

### 5.2 表行数一致性校验（3/3 通过）

| 表名 | 备份前 | 删除后 | 恢复后 | 结果 |
|------|--------|--------|--------|------|
| users | 1 | 0 | 1 | ✅ 一致 |
| wallets | 1 | 0 | 1 | ✅ 一致 |
| tasks | 1 | 0 | 1 | ✅ 一致 |

### 5.3 字段级数据一致性校验（3/3 通过）

#### users 表

| 字段 | 备份前 | 恢复后 | 结果 |
|------|--------|--------|------|
| id | 7 | 7 | ✅ |
| openid | drill_1785494188_openid | drill_1785494188_openid | ✅ |
| nickname | drill_user_drill_1785494188 | drill_user_drill_1785494188 | ✅ |
| phone | 13900000000 | 13900000000 | ✅ |
| credit_score | 95 | 95 | ✅ |
| role | USER | USER | ✅ |
| status | ACTIVE | ACTIVE | ✅ |

> 校验和: `7|drill_1785494188_openid|drill_user_drill_1785494188|13900000000|95|USER|ACTIVE`

#### wallets 表

| 字段 | 备份前 | 恢复后 | 结果 |
|------|--------|--------|------|
| user_id | 7 | 7 | ✅ |
| balance | 199.50 | 199.50 | ✅ |
| frozen | 10.00 | 10.00 | ✅ |

> 校验和: `7|199.50|10.00`

#### tasks 表

| 字段 | 备份前 | 恢复后 | 结果 |
|------|--------|--------|------|
| id | 7 | 7 | ✅ |
| title | drill_task_drill_1785494188 | drill_task_drill_1785494188 | ✅ |
| price | 80.00 | 80.00 | ✅ |
| view_count | 25 | 25 | ✅ |
| status | OPEN | OPEN | ✅ |

> 校验和: `7|drill_task_drill_1785494188|80.00|25|OPEN`

---

## 六、恢复流程说明

### 恢复操作步骤

```
1. 选择备份文件
   $ docker exec nh-backup-scheduler bash -c \
     "source /tmp/backup-env.sh && echo 'yes' | bash /scripts/restore.sh /backup/mysql/full_XXXXXX.sql.gz"

2. restore.sh 执行流程:
   ├── 验证备份文件完整性 (gunzip + header 检查)
   ├── 创建恢复前快照 (pre_restore_*.sql.gz)
   ├── 解压并恢复 (gunzip -c | mysql)
   └── 验证恢复结果 (表数量检查)
```

### 恢复安全机制

| 机制 | 说明 |
|------|------|
| 交互确认 | 恢复前需输入 "yes" 确认，防止误操作 |
| 恢复前快照 | 恢复前自动创建当前数据库快照到 /tmp/ |
| 完整性预检 | 恢复前验证备份文件 header 和 gunzip 可解压性 |
| 恢复后验证 | 检查恢复后的表数量是否符合预期 |

---

## 七、RTO/RPO 分析

### RTO (恢复时间目标)

| 场景 | 预计耗时 | 说明 |
|------|----------|------|
| 当前数据量 (752 KB) | 3s | 实测恢复时间 |
| 小型生产 (10 MB) | ~10s | 按比例估算 |
| 中型生产 (100 MB) | ~60s | 按比例估算 |
| 大型生产 (1 GB) | ~10min | 按比例估算 |

> 当前 RTO = 3s，远低于 15 分钟目标。

### RPO (恢复点目标)

| 备份策略 | 频率 | 最大数据丢失 |
|----------|------|-------------|
| 全量备份 | 每日 03:00 | 最多 24 小时 |
| 增量备份 (Binlog) | 每 6 小时 | 最多 6 小时 |
| 组合策略 | 全量 + Binlog | 最多 6 小时 |

> 当前 RPO = 6 小时（全量 + Binlog 组合），满足业务要求。

---

## 八、发现的问题与修复

### 问题 1: restore.sh dump header 校验不兼容

| 项目 | 详情 |
|------|------|
| 问题描述 | restore.sh 第 34 行检查 "MySQL dump" header，但容器使用 MariaDB 客户端，输出为 "MariaDB dump" |
| 影响范围 | 所有恢复操作无法通过完整性校验 |
| 根因分析 | Debian bookworm 的 `default-mysql-client` 实际链接到 MariaDB 客户端 |
| 修复方案 | 将 `grep -q "MySQL dump"` 改为 `grep -qE "(MySQL\|MariaDB) dump"`，同时扩大检查范围从 head -5 到 head -10 |
| 修复状态 | ✅ 已修复 |

---

## 九、演练结论

### 总体评价

| 评估维度 | 结果 | 说明 |
|----------|------|------|
| 备份功能 | ✅ 通过 | backup.sh 正常生成 gzip 压缩的 SQL 文件 |
| 恢复功能 | ✅ 通过 | restore.sh 正确恢复全部数据 |
| 数据完整性 | ✅ 通过 | 10/10 项校验全部通过 |
| 数据一致性 | ✅ 通过 | 行数 + 字段级双重校验通过 |
| 恢复速度 | ✅ 优秀 | 3s 恢复 752KB 数据库 |

### 建议与改进

1. **定期演练**: 建议每月执行一次完整的备份恢复演练，确保备份可靠性
2. **COS 远程备份**: 当前 COS 上传未配置（使用占位符），生产环境需配置真实的腾讯云 COS 凭证
3. **Binlog 恢复测试**: 本次仅验证了全量备份恢复，建议后续补充 Binlog 增量恢复测试
4. **大流量压测**: 当前数据量较小（752 KB），建议在预发布环境使用更大数据量进行压测
5. **自动化监控**: 建议配置备份失败告警，确保备份任务异常时能及时发现

---

## 附录: 演练命令

```bash
# 执行备份恢复演练
docker exec nh-backup-scheduler bash -c \
  "source /tmp/backup-env.sh && bash /tmp/run-drill.sh"

# 手动执行备份
docker exec nh-backup-scheduler bash -c \
  "source /tmp/backup-env.sh && bash /scripts/backup.sh"

# 手动执行恢复
docker exec nh-backup-scheduler bash -c \
  "source /tmp/backup-env.sh && echo 'yes' | bash /scripts/restore.sh /backup/mysql/full_XXXXXX.sql.gz"

# 验证备份完整性
docker exec nh-backup-scheduler bash -c \
  "source /tmp/backup-env.sh && bash /scripts/verify-backup.sh"

# 查看备份文件列表
docker exec nh-backup-scheduler ls -lh /backup/mysql/
```

---

*报告生成时间: 2026-07-31 18:37 CST*  
*演练执行人: 自动化脚本*  
*报告工具: deploy/run-drill.sh*
