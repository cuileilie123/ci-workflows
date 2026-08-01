# 社区邻里有偿互助平台

> 微信小程序 + NestJS BFF + Go/Java 微服务  
> 发单 → 接单 → 支付 → 评价 完整闭环  
> **100 条需求 × 20 个 Prompt × 16 个 Task = 可直接交付的 AI 工程包**

---

## 📁 完整项目结构

```
neighborhood-help/
├── .trae/                    # Trae AI 工作区配置
│   ├── config.yaml           #   模型/规则/执行策略
│   └── memory.md             #   长期记忆（架构决策/技术栈/禁止事项）
│
├── .github/                  # CI/CD
│   └── workflows/
│       └── ci.yml            #   GitHub Actions 全流水线
│
├── specs/                    # 需求规格（人类可读）
│   ├── 01-auth.md           #   认证与用户体系
│   ├── 02-task.md           #   任务发布与接单
│   ├── 03-payment.md        #   支付与钱包
│   ├── 04-im.md             #   即时通讯
│   ├── 05-risk.md           #   风控与安全
│   └── 06-ops.md           #   运营管理后台
│
├── prompts/                  # ★ Trae 可执行 Prompt（共 20 个）
│   │
│   ├── frontend/            #   小程序端（8 个 Prompt）
│   │   ├── 01-init-miniprogram.prompt.md
│   │   ├── 02-wx-login.prompt.md
│   │   ├── 03-task-publish.prompt.md
│   │   ├── 04-task-list.prompt.md
│   │   ├── 05-task-detail.prompt.md
│   │   ├── 06-wx-payment.prompt.md
│   │   ├── 07-user-profile.prompt.md
│   │   ├── 08-subscribe-share.prompt.md
│   │   └── 09-map-location.prompt.md
│   │
│   ├── bff/                 # NestJS BFF 端（7 个 Prompt）
│   │   ├── 01-nestjs-init.prompt.md
│   │   ├── 02-wx-login-gateway.prompt.md
│   │   ├── 03-task-service.prompt.md
│   │   ├── 04-payment-gateway.prompt.md
│   │   ├── 05-im-websocket.prompt.md
│   │   ├── 06-review-credit.prompt.md
│   │   ├── 07-wallet-withdraw.prompt.md
│   │   ├── 12-file-upload-cos.prompt.md
│   │   └── prisma-schema.prompt.md
│   │
│   └── backend/             # 后端微服务（5 个 Prompt）
│       ├── 08-risk-control.prompt.md
│       ├── 09-admin-dashboard.prompt.md
│       ├── 10-mq-events.prompt.md
│       ├── 11-elasticsearch.prompt.md
│       ├── 13-monitoring-logging.prompt.md
│       ├── 14-cicd-deploy.prompt.md
│       └── 15-data-migration-backup.prompt.md
│
├── tasks/                    # 迭代任务（16 个，按依赖排序）
│   ├── 001-setup-repo.task.md
│   ├── 002-wx-login.task.md
│   ├── 003-task-publish-list.task.md
│   ├── 004-task-detail-accept.task.md
│   ├── 005-wx-payment.task.md
│   ├── 006-im-chat.task.md
│   ├── 007-review-credit.task.md
│   ├── 008-wallet-withdraw.task.md
│   ├── 009-risk-control.task.md
│   ├── 010-admin-dashboard.task.md
│   ├── 011-data-migration.task.md
│   ├── 012-monitoring.task.md
│   ├── 013-cicd.task.md
│   ├── 014-es-search.task.md
│   ├── 015-user-center.task.md
│   └── 016-file-upload.task.md
│
├── monitoring/               # 监控配置
│   ├── prometheus.yml
│   ├── alert_rules.yml
│   ├── alertmanager.yml
│   ├── grafana-dashboard.json
│   └── filebeat.yml
│
├── scripts/                  # 运维脚本（已通过 18 项自动化测试 ✅）
│   ├── backup.sh             #   全量备份（mysqldump + gzip + COS 上传）
│   ├── restore.sh            #   恢复脚本（自动快照 + 完整性校验）
│   ├── binlog-backup.sh      #   增量备份（Binlog flush + 文件复制）
│   ├── verify-backup.sh      #   备份完整性验证（Dump completed 检查）
│   ├── cleanup-old-backups.sh #  30 天自动清理（本地 + COS）
│   ├── disaster-recovery.sh  #   灾备演练（主库故障注入 + 数据一致性校验）
│   └── test-backup-restore.sh #  自动化测试脚本（18 项用例）
│
├── deploy/
│   └── cron/
│       └── backup-cron       #   Cron 定时任务（全量/增量/验证/清理）
│
├── docker-compose.yml       # 一键拉起所有基础设施
├── .env.example            # 环境变量模板
└── README.md
```

---

## 🚀 快速开始

### 三步开干

```bash
# 1. 启动基础设施
cd neighborhood-help
docker-compose up -d

# 2. 配置环境变量
cp .env.example .env
vim .env  # 填入真实密钥

# 3. 用 Trae 打开文件夹，按 Task 顺序执行
```

### 执行顺序（推荐）

```
Phase 1 - 地基（Day 1）
  Task 001 → Task 011 → Task 016

Phase 2 - 核心闭环（Day 2-3）
  Task 002 → Task 003 → Task 004 → Task 005

Phase 3 - 体验增强（Day 4）
  Task 006 → Task 015 → Task 014

Phase 4 - 信任体系（Day 5）
  Task 007 → Task 008 → Task 009

Phase 5 - 运营+工程化（Day 6-7）
  Task 010 → Task 012 → Task 013
```

---

## 🛠 技术栈一览

| 层 | 技术 | 端口 | 用途 |
|----|------|------|------|
| 前端 | UniApp 3 + TS + Pinia | - | 微信小程序 |
| BFF | NestJS 10 + Prisma | 3000 | 鉴权/聚合/WebSocket |
| 风控 | Go 1.22 + Gin | 8080 | 设备指纹/规则引擎 |
| 管理 | Java 21 + Spring Boot | 8081 | 运营后台 API |
| 搜索 | Elasticsearch 8 + IK | 9200 | 全文检索 |
| 消息 | RabbitMQ 3.13 | 5672 | 事件驱动 |
| 缓存 | Redis 7 | 6379 | 缓存/会话/队列 |
| 数据库 | MySQL 8.0 | 3306 | 业务数据 |
| 文档库 | MongoDB 7 | 27017 | IM 消息 |
| 存储 | 腾讯云 COS | - | 图片/文件 |
| 监控 | Prometheus + Grafana | 9090/3002 | 指标看板 |
| 日志 | ELK Stack | 9201/5044 | 日志聚合 |
| 追踪 | Jaeger | 16686 | 分布式链路 |
| 编排 | Docker + K8s | - | 容器化部署 |

---

## 📋 16 个 Task 总览

| # | Task | Prompt 数 | 代码量 | 依赖 |
|---|------|----------|--------|------|
| 001 | 初始化仓库 | - | ~300 | - |
| 002 | 微信登录全链路 | 3 | ~800 | 001 |
| 003 | 任务发布+列表 | 3 | ~1200 | 002 |
| 004 | 任务详情+接单 | 1 | ~500 | 003 |
| 005 | 微信支付闭环 | 2 | ~900 | 004 |
| 006 | 即时通讯 | 1 | ~700 | 002 |
| 007 | 评价+信用分 | 1 | ~600 | 005 |
| 008 | 钱包+提现 | 1 | ~650 | 005 |
| 009 | 风控系统 | 1 | ~1000 | 003,007 |
| 010 | 运营后台+MQ | 2 | ~1500 | 005-009 |
| 011 | 数据库迁移+备份 | 2 | ~500 | 001 |
| 012 | 全链路监控 | 1 | ~800 | 010 |
| 013 | CI/CD+混沌工程 | 1 | ~600 | 011,012 |
| 014 | ES 全文搜索 | 1 | ~500 | 003 |
| 015 | 个人中心+地图 | 3 | ~700 | 005,007,008 |
| 016 | 文件上传 COS | 1 | ~400 | 002 |

> **总计：20 个 Prompt，16 个 Task，预计生成 ~12000 行代码**

---

## 📊 100 条需求 × Prompt 映射表

| 需求类别 | 对应需求条目 | 覆盖 Prompt | 条数 |
|---------|-------------|-------------|------|
| 前端基础 | #1-2, #13, #17-18, #21-25, #31, #43, #46-48 | frontend/01-09 | 17 |
| 认证体系 | #3-4, #27-30, #52, #91-94, #96 | bff/01-02, 07 | 11 |
| 任务服务 | #5-12, #15, #33-35, #54, #60-61, #84 | bff/03, frontend/03-05, 09 | 17 |
| 支付体系 | #16, #19-20, #36-37, #50, #55-56, #66 | bff/04, 07, frontend/06 | 10 |
| IM 通讯 | #14, #38-39, #63 | bff/05 | 5 |
| 评价信用 | #57, #65 | bff/06 | 2 |
| 风控安全 | #32, #40, #67, #83, #98 | bff/06, backend/08 | 5 |
| 运营管理 | #41-42, #44-45, #68, #85, #97 | backend/09-10 | 8 |
| 搜索服务 | #6, #62 | backend/11 | 2 |
| 监控日志 | #45, #75-82 | backend/13 | 8 |
| CI/CD | #71-74, #87-90, #99-100 | backend/14 | 10 |
| 数据管理 | #51, #53, #58-59, #69-70, #95-96, #98 | bff/prisma, backend/15 | 10 |
| **合计** | **全部 100 条** | **20 个 Prompt** | **100 ✅** |

---

## 💾 备份与恢复

### 架构概览

```
┌─────────────────────────────────────────────────┐
│                Docker Compose                    │
│                                                   │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐   │
│  │  MySQL   │────│  Backup  │────│   COS    │   │
│  │ (主库)   │    │ (Cron)   │    │ (云存储) │   │
│  └──────────┘    └──────────┘    └──────────┘   │
│       │               │               │          │
│       │   /scripts/   │  backups/    │          │
│       │   ─────────   │  mysql/     │          │
│       │   backup.sh   │  full_*.gz  │          │
│       │   restore.sh  │             │          │
│       │   verify.sh   │             │          │
│       │   cleanup.sh  │             │          │
│       │               │             │          │
│  ┌──────────┐                        │          │
│  │ Binlog   │────────────────────────│          │
│  │ (增量)   │    binlog-backup.sh    │          │
│  └──────────┘                        │          │
└─────────────────────────────────────────────────┘
```

### 快速上手

```bash
# 1. 启动基础设施
docker-compose up -d

# 2. 手动执行一次全量备份
docker exec nh-mysql bash /scripts/backup.sh

# 3. 查看备份文件
docker exec nh-mysql ls -lh /backup/mysql/

# 4. 恢复数据库（交互式，需输入 yes 确认）
docker exec nh-mysql bash /scripts/restore.sh /backup/mysql/full_20260731_064041.sql.gz

# 5. 验证恢复结果
docker exec nh-mysql bash /scripts/verify-backup.sh
```

### 备份策略

| 类型 | 频率 | 保留 | 脚本 |
|------|------|------|------|
| 全量备份 | 每日 03:00 | 30 天 | `backup.sh` |
| 增量备份 (Binlog) | 每 6 小时 | 30 天 | `binlog-backup.sh` |
| 完整性验证 | 每周日 04:00 | - | `verify-backup.sh` |
| 旧备份清理 | 每月 1 号 05:00 | - | `cleanup-old-backups.sh` |

### 备份文件规范

- **格式**：`mysqldump` + `gzip`（单文件，包含 `CREATE DATABASE` / `USE` / `DROP TABLE` / `CREATE TABLE` / `INSERT`）
- **范围**：仅业务库 `neighborhood_help`（排除 mysql/sys 等系统库）
- **编码**：`utf8mb4`（全量中文支持）
- **一致性**：`--single-transaction`（InnoDB 快照，不锁表）
- **文件命名**：`full_YYYYMMDD_HHMMSS.sql.gz`
- **大小**：约 3-5 KB（业务数据量较小时）

### Cron 定时任务

配置文件：[`deploy/cron/backup-cron`](file:///d:/neighborhood-help/deploy/cron/backup-cron)

```cron
# 每日 03:00 全量备份
0 3 * * * /scripts/backup.sh

# 每 6 小时增量备份
0 */6 * * * /scripts/binlog-backup.sh

# 每周日 04:00 验证备份
0 4 * * 0 /scripts/verify-backup.sh

# 每月 1 号 05:00 清理旧备份
0 5 1 * * /scripts/cleanup-old-backups.sh
```

### 自动化测试

运行全流程验证（18 项测试用例，通过率 100%）：

```bash
# 在 MySQL 容器中执行
docker exec nh-mysql bash /scripts/test-backup-restore.sh
```

测试覆盖：
1. **数据准备**：插入 users/wallets/tasks 三表关联数据
2. **特征记录**：记录备份前行数 + 字段校验和
3. **执行备份**：验证 `backup.sh` 成功
4. **文件验证**：文件存在、大小>0、完整性、格式、内容、日志
5. **模拟丢失**：删除测试数据
6. **执行恢复**：验证 `restore.sh` 成功
7. **一致性校验**：三表行数 + 三条记录字段完全一致
8. **清理数据**：按依赖顺序清理

### 灾备演练

```bash
docker exec nh-mysql bash /scripts/disaster-recovery.sh
```

演练流程：
1. 模拟主库故障（kill MySQL 容器）
2. 验证 API 降级能力
3. 数据一致性校验
4. 恢复服务

### 环境变量

```bash
# MySQL 连接
MYSQL_HOST=mysql
MYSQL_USER=root
MYSQL_PASSWORD=root123
MYSQL_DATABASE=neighborhood_help

# 腾讯云 COS（可选，用于云端备份）
COS_SECRET_ID=your_cos_secret_id
COS_SECRET_KEY=your_cos_secret_key
COS_BUCKET=neighborhood-help-1250000000
```

---

## ⚠️ 重要提醒

1. **环境变量**：复制 `.env.example` → `.env`，填入真实密钥
2. **微信支付**：需要企业认证小程序 + 微信支付商户号
3. **腾讯云 COS**：需要创建存储桶并配置 CORS
4. **数据库迁移**：`pnpm prisma migrate dev` 前确保 MySQL 可连接
5. **不要提交 `.env` 到 Git**！
6. **启动顺序**：先 `docker-compose up -d` → 等 DB 就绪 → 再启动应用
7. **首次运行**：先执行 Task 011（建表）再执行 Task 002（登录）

---

## 🤝 贡献指南

1. 每个 Prompt 执行完后，检查验收清单
2. 通过的 Prompt 标记 `✅` 到 `.trae/memory.md`
3. 踩坑记录追加到 `memory.md` 的"已知坑"章节
4. 新需求 → 先写 spec → 再写 prompt → 最后写 task
5. 所有 API 必须有 Swagger 注解
6. 所有数据库变更必须有迁移脚本
7. 所有 PR 必须通过 CI 检查（lint + test + security scan）

---

## 📝 License

MIT
