# 脚本维护手册

> **版本**: 1.1.0  
> **更新日期**: 2026-07-31  
> **适用环境**: 开发 / 测试 / 生产

---

## 一、概述

本手册描述社区邻里有偿互助平台备份恢复系统的所有脚本、配置文件及运维操作流程。

### 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Compose 网络                       │
│                                                             │
│  ┌───────────┐         ┌──────────────────────┐            │
│  │  nh-mysql  │◄────────│  nh-backup-scheduler  │            │
│  │  (MySQL    │  mysql  │  (Cron 调度器)         │            │
│  │   8.0)    │  协议   │                      │            │
│  └───────────┘         │  ┌──────────────────┐ │            │
│                        │  │  backup-init.sh  │ │            │
│                        │  │  (启动初始化)     │ │            │
│                        │  └──────────────────┘ │            │
│                        │          │            │            │
│                        │          ▼            │            │
│                        │  ┌──────────────────┐ │            │
│                        │  │  cron 守护进程    │ │            │
│                        │  │  (4 个定时任务)   │ │            │
│                        │  └──────────────────┘ │            │
│                        └──────────┬───────────┘            │
│                                   │                         │
│                          ┌────────▼─────────┐               │
│                          │  backup_data 卷   │               │
│                          │  /backup/mysql/   │               │
│                          └────────┬─────────┘               │
│                                   │                         │
│                          ┌────────▼─────────┐               │
│                          │  腾讯云 COS (可选) │               │
│                          └──────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

### 定时任务一览

| 任务 | 频率 | 脚本 | 说明 |
|------|------|------|------|
| 全量备份 | 每日 03:00 | backup.sh | mysqldump + gzip + 完整性校验 |
| 增量备份 | 每 6 小时 | binlog-backup.sh | FLUSH BINARY LOGS + 复制 binlog |
| 完整性验证 | 每周日 04:00 | verify-backup.sh | header + footer 双校验 |
| 清理旧备份 | 每月 1 号 05:00 | cleanup-old-backups.sh | 删除超过 30 天的备份 |

---

## 二、文件清单

### 脚本文件 (`scripts/`)

| 文件 | 用途 | 调用方式 |
|------|------|----------|
| `backup.sh` | 全量备份 | Cron 自动 / 手动 |
| `restore.sh` | 数据恢复 | 手动（交互确认） |
| `verify-backup.sh` | 备份完整性验证 | Cron 自动 / 手动 |
| `binlog-backup.sh` | Binlog 增量备份 | Cron 自动 |
| `cleanup-old-backups.sh` | 清理过期备份 | Cron 自动 |
| `test-backup-restore.sh` | 备份恢复自动化测试（18 项） | 手动 |
| `disaster-recovery.sh` | 灾备演练 | 手动 |

### 配置文件 (`deploy/`)

| 文件 | 用途 |
|------|------|
| `backup-init.sh` | 备份调度器启动初始化脚本 |
| `run-drill.sh` | 备份恢复演练脚本（收集耗时和一致性数据） |
| `cron/backup-cron` | Cron 任务配置参考文件（实际由 backup-init.sh 动态生成） |

### Docker 文件

| 文件 | 用途 |
|------|------|
| `docker-compose.backup.yml` | 备份调度器编排配置 |
| `Dockerfile.backup` | 备份调度器镜像构建文件 |

### 文档文件

| 文件 | 用途 |
|------|------|
| `BACKUP_DEPLOYMENT.md` | 生产环境部署指南 |
| `BACKUP_RECOVERY_DRILL_REPORT.md` | 备份恢复演练报告 |
| `SCRIPT_MAINTENANCE_MANUAL.md` | 本手册 |

---

## 三、核心脚本详解

### 3.1 backup-init.sh — 启动初始化

**文件位置**: `deploy/backup-init.sh`  
**调用者**: docker-compose.backup.yml entrypoint  
**执行环境**: nh-backup-scheduler 容器内

**执行流程 (4 个阶段)**:

```
[1/4] 等待 MySQL 就绪
      └── mysqladmin ping 重试 30 次，每次间隔 2s
      └── 超时后发出警告但不阻塞启动

[2/4] 初始化备份目录
      └── 创建 /backup/mysql (权限 755)
      └── 创建日志文件 (backup.log / binlog-backup.log / verify.log / cleanup.log)

[3/4] 验证已有备份文件  ← v1.1.0 新增
      └── 扫描 /backup/mysql/full_*.sql.gz
      └── 逐文件执行 header + footer 双校验
      └── 报告: 有效 N 份, 可疑 N 份

[4/4] 配置定时任务
      └── 生成 /tmp/backup-env.sh (占位符替换为实际环境变量)
      └── 生成 /etc/cron.d/backup-cron (4 个定时任务)
      └── 启动 cron -f (前台模式)
```

**环境变量注入机制**:

```
Docker Compose env  →  backup-init.sh  →  sed 占位符替换  →  /tmp/backup-env.sh
                                                                   │
                                   Cron 任务执行时 source ◄──────────┘
```

> **注意**: Cron 任务默认无法读取容器环境变量，通过 `/tmp/backup-env.sh` 文件中转解决。每个 Cron 任务都以 `source /tmp/backup-env.sh &&` 开头。

### 3.2 backup.sh — 全量备份

**文件位置**: `scripts/backup.sh`

**执行流程**:

```
1. mysqldump 全量导出
   ├── --single-transaction  (InnoDB 一致性快照，不锁表)
   ├── --routines --triggers --events  (包含存储过程/触发器/事件)
   ├── --databases neighborhood_help  (仅业务库)
   ├── --hex-blob  (BLOB 字段十六进制导出)
   └── --set-charset --default-character-set=utf8mb4
       │
       ▼ gzip
   full_YYYYMMDD_HHMMSS.sql.gz

2. COS 上传 (可选)
   ├── 检查 coscmd 是否安装 + COS_SECRET_ID/KEY 是否配置
   ├── 自动配置 coscmd (首次使用)
   └── 上传失败不影响本地备份

3. Binlog 刷新
   └── FLUSH BINARY LOGS (为增量备份准备)

4. 本地旧备份清理
   └── find -mtime +30 -delete

5. COS 旧备份清理 (可选)

6. 完整性校验  ← v1.1.0 优化为双校验
   ├── header 校验: grep -qE "(MySQL|MariaDB) dump"
   ├── footer 校验: grep -q "Dump completed"
   └── 记录到 backup_log.csv
```

**校验策略**:

| header | footer | 结果 | 记录日志 |
|--------|--------|------|----------|
| ✅ | ✅ | 验证通过 | ✅ 写入 backup_log.csv |
| ❌ | ✅ | 部分通过（非标准客户端） | ✅ 写入 backup_log.csv |
| ❌ | ❌ | 验证失败 | ❌ exit 1 |
| ✅ | ❌ | 验证失败 | ❌ exit 1 |

### 3.3 restore.sh — 数据恢复

**文件位置**: `scripts/restore.sh`

**安全机制**:

| 机制 | 说明 |
|------|------|
| 交互确认 | 恢复前必须输入 `yes` 确认 |
| 完整性预检 | header 校验: `grep -qE "(MySQL\|MariaDB) dump"` |
| 恢复前快照 | 自动创建 `pre_restore_YYYYMMDD_HHMMSS.sql.gz` |
| 恢复后验证 | 检查表数量是否正常 |

**执行流程**:

```
1. 接收备份文件路径 (本地 / cos:// / s3://)
2. 交互确认 (yes/no)
3. 下载/复制备份文件到 /tmp/restore.sql.gz
4. header 完整性校验  ← v1.1.0 修复: 兼容 MariaDB
5. 创建恢复前快照
6. gunzip -c | mysql 恢复
7. 验证表数量
8. 清理临时文件
```

### 3.4 verify-backup.sh — 完整性验证

**文件位置**: `scripts/verify-backup.sh`

**校验逻辑** (v1.1.0 优化):

```bash
# header 校验 (兼容 MySQL/MariaDB)
gunzip -c "$LATEST_BACKUP" | head -10 | grep -qE "(MySQL|MariaDB) dump"

# footer 校验
gunzip -c "$LATEST_BACKUP" | tail -5 | grep -q "Dump completed"
```

**输出示例**:
```
🔍 验证备份完整性 - Fri Jul 31 18:45:19 CST 2026
检查备份: /backup/mysql/full_20260731_184431.sql.gz
✅ 最新备份验证通过 (header + footer)
备份记录:
20260731_175846,full_20260731_175846.sql.gz,2939
20260731_184431,full_20260731_184431.sql.gz,2939
✅ 验证完成 - Fri Jul 31 18:45:19 CST 2026
```

### 3.5 binlog-backup.sh — 增量备份

**文件位置**: `scripts/binlog-backup.sh`

**执行流程**:
1. `FLUSH BINARY LOGS` — 切换到新的 binlog 文件
2. 复制 `/var/lib/mysql/mysql-bin.*` 到 `/backup/mysql/binlog/`

> **注意**: 当前容器通过 Docker 网络连接 MySQL，`/var/lib/mysql` 在备份调度器容器内不存在。生产环境需将 MySQL 的 binlog 目录挂载到备份调度器容器，或改用 `mysqlbinlog --read-from-remote-server` 远程拉取。

### 3.6 cleanup-old-backups.sh — 清理旧备份

**文件位置**: `scripts/cleanup-old-backups.sh`

**清理范围**:
- 本地: `find /backup/mysql -name "full_*.sql.gz" -mtime +30 -delete`
- COS: 遍历 `coscmd list`，删除超过 30 天的文件

### 3.7 test-backup-restore.sh — 自动化测试

**文件位置**: `scripts/test-backup-restore.sh`

**测试用例 (18 项)**:

| 阶段 | 测试项 |
|------|--------|
| 数据准备 | 插入 users / wallets / tasks |
| 备份执行 | backup.sh 执行成功 |
| 文件验证 | 文件存在 / 大小 > 0 / footer 校验 / **header 校验** / 包含测试数据 / 日志记录 |
| 数据删除 | users / wallets / tasks 删除验证 |
| 数据恢复 | restore.sh 执行成功 |
| 一致性 | users / wallets / tasks 行数一致 / 字段校验和一致 |

> v1.1.0 修复: 第 174 行 header 校验从 `grep "MySQL dump"` 改为 `grep -qE "(MySQL|MariaDB) dump"`

### 3.8 run-drill.sh — 演练脚本

**文件位置**: `deploy/run-drill.sh`

收集各阶段精确耗时和 10 项校验结果，生成演练数据供报告使用。

---

## 四、Header 校验逻辑说明 (v1.1.0 核心优化)

### 问题背景

备份调度器镜像基于 `debian:bookworm-slim`，安装的 `default-mysql-client` 实际链接到 **MariaDB 客户端**，导致 `mysqldump` 输出的 header 为:

```
-- MariaDB dump 10.19  Distrib 10.11.18-MariaDB, for debian-linux-gnu (x86_64)
```

而非 MySQL 客户端的:

```
-- MySQL dump 10.13  Distrib 8.0.46, for Linux (x86_64)
```

原脚本仅检查 `"MySQL dump"`，导致恢复和测试脚本校验失败。

### 解决方案

所有涉及 dump header 校验的位置统一使用正则:

```bash
grep -qE "(MySQL|MariaDB) dump"
```

### 涉及文件

| 文件 | 行号 | 修改前 | 修改后 | 状态 |
|------|------|--------|--------|------|
| `restore.sh` | 35 | `grep -q "MySQL dump"` | `grep -qE "(MySQL\|MariaDB) dump"` | ✅ 已修复 |
| `backup.sh` | 72 | (无 header 校验) | 新增 `grep -qE "(MySQL\|MariaDB) dump"` | ✅ 已新增 |
| `verify-backup.sh` | 24 | (无 header 校验) | 新增 `grep -qE "(MySQL\|MariaDB) dump"` | ✅ 已新增 |
| `test-backup-restore.sh` | 174 | `grep -q "MySQL dump"` | `grep -qE "(MySQL\|MariaDB) dump"` | ✅ 已修复 |
| `backup-init.sh` | 51 | (无备份验证) | 新增启动时批量校验 | ✅ 已新增 |
| `run-drill.sh` | - | `grep -q "MySQL dump"` | `grep -qE "(MySQL\|MariaDB) dump"` | ✅ 已修复 |

---

## 五、Docker Compose 配置

### 5.1 服务架构

| 服务 | 用途 | 启动方式 |
|------|------|----------|
| `backup-scheduler` | Cron 定时调度 | 常驻运行 |
| `backup-executor` | 手动执行备份/恢复 | `--profile executor` 按需启动 |
| `backup-viewer` | 只读查看备份文件 | `--profile viewer` 按需启动 |

### 5.2 常用命令

```bash
# 启动备份调度器（与主服务一起）
docker compose -f docker-compose.yml -f docker-compose.backup.yml up -d backup-scheduler

# 查看调度器日志
docker compose -f docker-compose.backup.yml logs -f backup-scheduler

# 手动执行备份
docker compose -f docker-compose.backup.yml --profile executor run --rm \
  backup-executor bash /scripts/backup.sh

# 手动执行恢复
docker compose -f docker-compose.backup.yml --profile executor run --rm -it \
  backup-executor bash /scripts/restore.sh /backup/mysql/full_XXXXXX.sql.gz

# 查看备份文件
docker compose -f docker-compose.backup.yml --profile viewer up -d
docker compose -f docker-compose.backup.yml exec backup-viewer ls -lh /backup/mysql/

# 重启调度器（重新加载 backup-init.sh）
docker compose -f docker-compose.yml -f docker-compose.backup.yml restart backup-scheduler
```

### 5.3 资源限制

```yaml
deploy:
  resources:
    limits:
      memory: 512M
      cpus: '0.5'
    reservations:
      memory: 128M
      cpus: '0.25'
```

---

## 六、环境变量

### 必需变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MYSQL_HOST` | mysql | MySQL 主机地址 |
| `MYSQL_PORT` | 3306 | MySQL 端口 |
| `MYSQL_USER` | root | MySQL 用户名 |
| `MYSQL_PASSWORD` | root123 | MySQL 密码 |
| `MYSQL_DATABASE` | neighborhood_help | 业务数据库名 |

### 可选变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BACKUP_DIR` | /backup/mysql | 本地备份目录 |
| `TZ` | Asia/Shanghai | 时区 |
| `COS_SECRET_ID` | (空) | 腾讯云 COS SecretId |
| `COS_SECRET_KEY` | (空) | 腾讯云 COS SecretKey |
| `COS_BUCKET` | neighborhood-help-1250000000 | COS 存储桶名 |
| `COS_REGION` | ap-guangzhou | COS 地域 |

> COS 变量为空时，自动跳过远程上传，不影响本地备份。

---

## 七、日常运维操作

### 7.1 检查备份状态

```bash
# 查看调度器健康状态
docker inspect --format '{{.State.Status}}' nh-backup-scheduler

# 查看 Cron 任务
docker exec nh-backup-scheduler cat /etc/cron.d/backup-cron

# 查看环境变量文件
docker exec nh-backup-scheduler cat /tmp/backup-env.sh

# 查看备份文件列表
docker exec nh-backup-scheduler ls -lh /backup/mysql/

# 查看备份日志
docker exec nh-backup-scheduler cat /backup/mysql/backup_log.csv

# 查看各任务日志
docker exec nh-backup-scheduler tail -20 /var/log/backup.log
docker exec nh-backup-scheduler tail -20 /var/log/binlog-backup.log
docker exec nh-backup-scheduler tail -20 /var/log/verify.log
docker exec nh-backup-scheduler tail -20 /var/log/cleanup.log
```

### 7.2 手动触发备份

```bash
# 全量备份
docker exec nh-backup-scheduler bash -c \
  "source /tmp/backup-env.sh && bash /scripts/backup.sh"

# 增量备份
docker exec nh-backup-scheduler bash -c \
  "source /tmp/backup-env.sh && bash /scripts/binlog-backup.sh"

# 验证最新备份
docker exec nh-backup-scheduler bash -c \
  "source /tmp/backup-env.sh && bash /scripts/verify-backup.sh"
```

### 7.3 手动恢复数据

```bash
# 交互式恢复（需要确认）
docker exec -it nh-backup-scheduler bash -c \
  "source /tmp/backup-env.sh && bash /scripts/restore.sh /backup/mysql/full_XXXXXX.sql.gz"

# 非交互式恢复（自动化场景）
docker exec nh-backup-scheduler bash -c \
  "source /tmp/backup-env.sh && echo 'yes' | bash /scripts/restore.sh /backup/mysql/full_XXXXXX.sql.gz"
```

### 7.4 执行测试

```bash
# 18 项自动化测试
docker exec nh-backup-scheduler bash -c \
  "source /tmp/backup-env.sh && bash /scripts/test-backup-restore.sh"

# 完整演练（含耗时统计）
docker exec nh-backup-scheduler bash -c \
  "source /tmp/backup-env.sh && bash /tmp/run-drill.sh"
```

---

## 八、故障排查

### 8.1 Cron 任务未执行

**检查步骤**:

```bash
# 1. 确认 cron 进程运行
docker exec nh-backup-scheduler pgrep -a cron

# 2. 确认 cron 配置文件存在
docker exec nh-backup-scheduler cat /etc/cron.d/backup-cron

# 3. 确认环境变量文件存在
docker exec nh-backup-scheduler cat /tmp/backup-env.sh

# 4. 检查日志
docker exec nh-backup-scheduler cat /var/log/backup.log
```

**常见原因**:

| 原因 | 解决方案 |
|------|----------|
| cron 进程未启动 | 重启容器: `docker compose restart backup-scheduler` |
| /tmp/backup-env.sh 不存在 | 重启容器（backup-init.sh 会重新生成） |
| MySQL 不可达 | 检查 MySQL 容器状态和网络连通性 |
| Cron 格式错误 | 检查 `/etc/cron.d/backup-cron` 格式（需含 root 字段） |

### 8.2 备份验证失败

```bash
# 手动验证备份文件
docker exec nh-backup-scheduler bash -c \
  "gunzip -c /backup/mysql/full_XXXXXX.sql.gz | head -10"
# 预期: 包含 "-- MySQL dump" 或 "-- MariaDB dump"

docker exec nh-backup-scheduler bash -c \
  "gunzip -c /backup/mysql/full_XXXXXX.sql.gz | tail -5"
# 预期: 包含 "-- Dump completed"
```

### 8.3 COS 上传失败

COS 上传失败不影响本地备份。如需启用:

1. 在 `.env` 文件中配置真实的 COS 凭证
2. 重启备份调度器容器
3. 手动测试: `docker exec nh-backup-scheduler coscmd config -a`

### 8.4 恢复后表数量异常

```bash
# 检查表数量
docker exec nh-backup-scheduler bash -c \
  "source /tmp/backup-env.sh && \
   mysql -h\$MYSQL_HOST -u\$MYSQL_USER -p\$MYSQL_PASSWORD -N -e \
   \"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='\$MYSQL_DATABASE';\""
```

---

## 九、版本变更记录

### v1.1.0 (2026-07-31)

**Header 校验兼容性优化**:

- `restore.sh`: 修复 `grep "MySQL dump"` → `grep -qE "(MySQL|MariaDB) dump"`，解决 MariaDB 客户端 header 不匹配问题
- `backup.sh`: 新增 header 校验，从 footer 单校验升级为 header + footer 双校验
- `verify-backup.sh`: 同步升级为双校验
- `test-backup-restore.sh`: 修复第 174 行 header 校验
- `backup-init.sh`: 新增启动时已有备份文件批量验证（步骤 3/4）
- `run-drill.sh`: 同步修复 header 校验

**COS 容错优化**:

- `backup.sh`: COS 未配置或上传失败时优雅降级，不影响本地备份
- `cleanup-old-backups.sh`: COS 清理增加错误忽略

### v1.0.0 (2026-07-31)

- 初始版本
- 创建 backup.sh / restore.sh / verify-backup.sh / binlog-backup.sh / cleanup-old-backups.sh
- 创建 test-backup-restore.sh（18 项自动化测试）
- 创建 docker-compose.backup.yml（3 个服务: scheduler / executor / viewer）
- 创建 Dockerfile.backup（debian:bookworm-slim 基础镜像）
- 创建 backup-init.sh（Cron 初始化 + 环境变量注入）
- 创建 deploy.sh / deploy.ps1（一键部署脚本）
- 创建 BACKUP_DEPLOYMENT.md（部署指南）
- 创建 BACKUP_RECOVERY_DRILL_REPORT.md（演练报告）

---

## 十、维护建议

1. **定期演练**: 每月执行一次 `run-drill.sh`，验证备份恢复可靠性
2. **监控告警**: 配置备份失败告警（检查 `/var/log/backup.log` 的 exit code）
3. **容量规划**: 定期检查 `backup_data` 卷使用率，超过 80% 时扩容
4. **COS 配置**: 生产环境务必配置真实的 COS 凭证，实现异地备份
5. **Binlog 优化**: 生产环境考虑使用 `mysqlbinlog --read-from-remote-server` 替代文件复制
6. **版本升级**: 升级 MySQL 客户端后，重新运行 `test-backup-restore.sh` 验证兼容性

---

*最后更新: 2026-07-31 18:45 CST*
