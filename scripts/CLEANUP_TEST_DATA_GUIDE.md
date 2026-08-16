# 清理测试数据脚本指南（cleanup-test-data.cjs）

> 在每次测试运行前，自动清理上一轮测试残留在数据库中的脏数据，避免测试用例相互干扰。
>
> 脚本路径：[`scripts/cleanup-test-data.cjs`](./cleanup-test-data.cjs)

---

## 目录

- [一、用途与背景](#一用途与背景)
- [二、清理范围](#二清理范围)
- [三、安全设计](#三安全设计)
- [四、快速开始](#四快速开始)
- [五、命令行参数](#五命令行参数)
- [六、运行示例](#六运行示例)
- [七、CI 集成步骤](#七ci-集成步骤)
- [八、推荐工作流](#八推荐工作流)
- [九、测试覆盖](#九测试覆盖)
- [十、日志说明](#十日志说明)
- [十一、故障排查](#十一故障排查)

---

## 一、用途与背景

### 解决的问题

本项目存在多类测试，它们会在数据库中创建测试数据：

| 测试类型 | 创建的数据 | openid 前缀 |
|---|---|---|
| wallet 集成测试 | 测试用户 + 钱包 | `jest_integration_test_` |
| finance 持久化集成测试 | BOSS 用户 + 财务设置单例 | `finance_setting_integration_test_` |
| auth 冒烟测试（cjs） | 测试用户 | `cjs_test_finance_` |
| test-login（无 userId） | mock 用户 | `mock_user_` |

如果测试中途崩溃或未正确清理，这些数据会残留，导致：

- 下一轮测试因唯一约束（openid 重复）失败
- count 断言数量不符
- 分佣配置被旧测试数据污染，诊断结果失真

本脚本在测试前统一清理这些残留，保证每轮测试从干净状态开始。

### 核心能力

- **按 openid 前缀识别测试数据**（不误删真实用户）
- **按外键依赖顺序删除**（避免违反外键约束）
- **默认 dry-run 预览**（安全第一，不误删）
- **DB 不可达时友好跳过**（CI MySQL 未就绪时不阻断流程）

---

## 二、清理范围

### 涉及的表与删除顺序

按外键依赖关系，从子表到父表依次删除：

```
transactions        ← 依赖 wallet
    ↓
wallets             ← 依赖 user
    ↓
staff_permissions   ← 依赖 user
    ↓
audit_logs          ← 依赖 admin(user)
    ↓
users               ← 测试用户（按 openid 前缀匹配）
    ↓
platform_finance_settings  ← 财务设置单例（id = 1）
```

### 匹配规则

- **用户**：`openid` 以以下任一前缀开头：
  - `jest_integration_test_`
  - `finance_setting_integration_test_`
  - `cjs_test_finance_`
  - `mock_user_`
- **钱包/交易/员工权限**：通过 `userId` 关联到上述测试用户
- **审计日志**：仅删除 `adminId` 属于上述测试用户的记录（**保守策略**：不会误删真实 BOSS 通过 BFF 测试脚本产生的操作日志）
- **财务设置**：删除 `platform_finance_settings` 表 `id = 1` 的单例行

---

## 三、安全设计

本脚本对生产数据安全做了多层防护：

| 防护层 | 机制 | 说明 |
|---|---|---|
| **1. 默认 dry-run** | 不传 `--confirm` 时只扫描预览 | 显示匹配数和样本，不删除任何数据 |
| **2. 二次确认** | `--confirm` 后需再传 `-y` | 防止误操作；CI 中用 `--confirm -y` 跳过确认 |
| **3. 清理后校验** | 删除完成后再扫描一次 | 确认数据库恢复干净，校验失败则 `exit 1` |
| **4. 前缀白名单** | 仅匹配 4 个测试 openid 前缀 | 真实用户（非测试前缀）绝不会被删 |
| **5. 审计日志保守** | 只删测试用户产生的审计日志 | 真实 BOSS 的操作日志完整保留 |
| **6. DB 探针** | 操作前先用单例表 `count()` 探活 | DB 不可达/表不存在时友好跳过，`exit 0` 不阻断 |
| **7. 外键顺序** | 子表先于父表删除 | 避免违反外键约束 |

### DB 不可达时的友好跳过

当遇到以下情况时，脚本会打印原因并 `exit 0`（不阻断 CI）：

- Prisma 错误码：`P1001`、`P1003`、`P1008`、`P2010`
- 错误消息含：`Can't reach database server`、`Unknown table`、`ER_NO_SUCH_TABLE`、`1146`、`ECONNREFUSED`、`ENOTFOUND`

> 这是 CI 集成的关键设计：当 MySQL service 尚未就绪或尚未 `prisma migrate deploy` 时，清理步骤不会成为单点故障。

---

## 四、快速开始

### 方式 1：npm 命令（推荐）

**根目录**（`d:\neighborhood-help`）：

```bash
npm run cleanup:test-data         # dry-run 预览（默认安全）
npm run cleanup:test-data:force   # 实际清理（--confirm -y）
```

**BFF 目录**（`d:\neighborhood-help\bff`）：

```bash
npm run cleanup:test-data         # dry-run 预览
npm run cleanup:test-data:force   # 实际清理
```

> 两个目录的命令等价，脚本内部用 `__dirname` 解析路径，与运行目录无关。

### 方式 2：直接运行 node

```bash
# 预览（不删除）
node scripts/cleanup-test-data.cjs

# 实际清理
node scripts/cleanup-test-data.cjs --confirm -y
```

---

## 五、命令行参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `--confirm` | 实际执行删除（否则为 dry-run 预览） | `false`（dry-run） |
| `-y`, `--yes` | 跳过二次确认（配合 `--confirm` 使用） | `false` |
| `--target=<目标>` | 选择性清理：`all` / `users` / `finance` | `all` |
| `-h`, `--help` | 显示帮助 | — |

### `--target` 选项说明

| 值 | 清理内容 |
|---|---|
| `all`（默认） | 测试用户级联 + 财务设置单例（全部） |
| `users` | 仅清理测试用户及其关联数据（钱包/交易/员工权限/审计日志） |
| `finance` | 仅清理财务设置单例（`platform_finance_settings` id=1） |

示例：

```bash
# 只清理测试用户
node scripts/cleanup-test-data.cjs --confirm -y --target=users

# 只清理财务设置单例
node scripts/cleanup-test-data.cjs --confirm -y --target=finance
```

---

## 六、运行示例

### dry-run 预览输出

```
2026-08-15 21:44:12  ╭─ 清理测试数据（DRY-RUN 预览，不删除） ─────────────
2026-08-15 21:44:12  │ DATABASE_URL = mysql://root:***@localhost:3306/neighborhood_help
2026-08-15 21:44:12  │
2026-08-15 21:44:12  │ [扫描] 测试用户（前缀匹配）...
2026-08-15 21:44:12  │   ✓ 匹配 2 个测试用户
2026-08-15 21:44:12  │     示例: mock_user_ci_a_1786799000, mock_user_ci_b_1786799000
2026-08-15 21:44:12  │ [扫描] 钱包（关联测试用户）...
2026-08-15 21:44:12  │   ✓ 匹配 1 个钱包
2026-08-15 21:44:12  │ [扫描] 财务设置单例...
2026-08-15 21:44:12  │   ✓ 匹配 1 行（id=1）
2026-08-15 21:44:12  │
2026-08-15 21:44:12  │ 预计删除: 用户=2 钱包=1 交易=0 单例=1
2026-08-15 21:44:12  ╰─ 如需实际清理，请加 --confirm（CI 用 --confirm -y）
```

### `--confirm -y` 实际清理输出

```
2026-08-15 21:44:13  ╭─ 清理测试数据（实际执行） ────────────────────────
2026-08-15 21:44:13  │ [删除] transactions ...     ✓ 删除 0 行
2026-08-15 21:44:13  │ [删除] wallets ...           ✓ 删除 1 行
2026-08-15 21:44:13  │ [删除] staff_permissions ... ✓ 删除 0 行
2026-08-15 21:44:13  │ [删除] audit_logs ...        ✓ 删除 1 行
2026-08-15 21:44:13  │ [删除] users ...             ✓ 删除 2 行
2026-08-15 21:44:13  │ [删除] platform_finance_settings ... ✓ 删除 1 行
2026-08-15 21:44:13  │
2026-08-15 21:44:13  │ 合计删除: 5 行
2026-08-15 21:44:13  │ [校验] 清理后再次扫描...
2026-08-15 21:44:13  │   ✓ 数据库已恢复干净状态
2026-08-15 21:44:13  ╰─ 清理完成（exit 0）
```

### DB 不可达时友好跳过

```
2026-08-15 21:44:14  ⚠ 数据库不可达或表未创建，跳过清理
2026-08-15 21:44:14    原因: Can't reach database server at `localhost`:3306
2026-08-15 21:44:14    （CI：MySQL service 未就绪或尚未 prisma migrate deploy，不阻断后续步骤）
```

---

## 七、CI 集成步骤

清理步骤已集成到 GitHub Actions：[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)。

### 当前 CI 配置

在 `bff-check` job 中，`prisma generate` 之后、`lint` 之前插入清理步骤：

```yaml
defaults:
  run:
    working-directory: bff

jobs:
  bff-check:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: mysql://root:test@localhost:3306/test_db
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma generate

      # 测试前清理 DB 脏数据（mock_user / 测试用户 / 财务设置单例 / 审计日志残留）
      # 脚本在 DB 不可达或表未 migrate 时会友好跳过（exit 0），不阻断后续步骤
      - name: Clean test data (before tests)
        run: node ../scripts/cleanup-test-data.cjs --confirm -y

      - run: pnpm lint
      - run: pnpm test
      # ...
```

### 设计要点

1. **位置**：在 `prisma generate` 之后（PrismaClient 就绪前提）、`lint`/`test` 之前
2. **不阻断**：脚本对 DB 不可达/表不存在友好跳过（`exit 0`），CI 步骤链不会因此中断
3. **不加 `continue-on-error`**：脚本自身已容错，真 bug（如脚本语法错误）才 `exit 1` 并暴露问题
4. **CI MySQL 未就绪时**：清理步骤跳过，单元测试用 mock 不受影响；若 CI 后续引入 `prisma migrate deploy`，清理步骤会自动从"跳过"转为"真正执行"

### CI 执行流程

```
checkout → pnpm install → prisma generate
  ↓
Clean test data (before tests)   ← 清理上轮残留
  ↓
lint → 单元测试 → 集成测试 → build
```

---

## 八、推荐工作流

### 本地开发

```bash
# 1. 跑测试（可能因脏数据残留失败）
cd bff && npm run test:finance

# 2. 预览要清理的脏数据
npm run cleanup:test-data

# 3. 确认无误后清理
npm run cleanup:test-data:force

# 4. 重新跑测试，干净通过
npm run test:finance
```

### CI 环境

无需手动操作，CI 流水线会在每次测试前自动执行 `--confirm -y` 清理。

---

## 九、测试覆盖

本脚本有完整的双层测试体系：

| 层级 | 文件 | 用例数 | DB | 覆盖范围 |
|---|---|---|---|---|
| **单元测试** | [`bff/src/scripts/cleanup-test-data.spec.ts`](../bff/src/scripts/cleanup-test-data.spec.ts) | 40 | mock | 函数级逻辑 |
| **集成测试** | [`bff/src/scripts/cleanup-test-data.integration.spec.ts`](../bff/src/scripts/cleanup-test-data.integration.spec.ts) | 5 | 真实+mock | 端到端 CI 流程 |

### 单元测试（40 用例）

覆盖 6 个核心模块的分支逻辑，用 mock prisma（不连真实 DB）：

1. **配置常量**（2）：前缀完整性、单例 ID
2. **parseArgs**（9）：参数解析、错误分支（`exit 1`/`exit 0`）
3. **isDbUnreachableError**（16）：错误识别矩阵（10 不可达 + 6 业务错误）
4. **probeDatabase**（2）：探针成功/失败
5. **scan**（4）：前缀查询、级联查询、walletIds 空时回退
6. **cleanup**（6）：外键顺序、target 分支、count 统计

### 集成测试（5 场景）

模拟 CI 环境端到端验证，调用 `main()` 走完整真实路径：

| 场景 | 模拟的 CI 情况 | 验证 |
|---|---|---|
| 1. 主流程 | DB 有上轮残留 | 清理后全为 0，`exit 0` |
| 2. 空跑 | DB 无脏数据 | 显示干净状态，`exit 0` |
| 3. dry-run | 无 `--confirm` | 脏数据仍存在（不删） |
| 4. MySQL 未就绪 | mock 抛 P1001 | 友好跳过 `exit 0`，不阻断 |
| 5. 表未 migrate | mock 抛 P2010 | 友好跳过 `exit 0`，不阻断 |

### 运行测试

```bash
cd bff

# 单元测试（mock，快速）
npx jest --config jest.config.ts --testPathPatterns="scripts/cleanup-test-data.spec" --no-coverage

# 集成测试（真实 DB + mock 容错）
npx jest --config jest.integration.config.ts --testPathPatterns="scripts/cleanup-test-data.integration" --runInBand
```

---

## 十、日志说明

### 日志格式

每条日志包含毫秒级时间戳：

```
YYYY-MM-DD HH:mm:ss  内容
```

### 日志级别与锚点

- `✓` 成功操作
- `⚠` 警告（如 DB 不可达跳过）
- `✗` 失败（如清理后校验未通过）
- `[扫描]` / `[删除]` / `[校验]` 阶段标记

### 敏感信息脱敏

日志中 `DATABASE_URL` 的密码会被脱敏：

```
DATABASE_URL = mysql://root:***@localhost:3306/neighborhood_help
```

### 文件日志（test-finance 脚本）

> 注：本清理脚本仅输出到控制台。如需文件日志，参考 [`test-boss-finance-settings.cjs`](./test-boss-finance-settings.cjs) 的日志系统（写入 `logs/test-finance-*.log`）。

---

## 十一、故障排查

### Q1：清理后仍有测试数据残留？

**可能原因**：测试数据的 openid 不在 4 个匹配前缀内。

**排查**：

```bash
# 查看残留测试数据的 openid
node -e "const {PrismaClient}=require('./bff/node_modules/@prisma/client');const p=new PrismaClient();(async()=>{const u=await p.user.findMany({where:{openid:{startsWith:'test_'}},select:{openid:true}});console.log(u);await p.\$disconnect()})()"
```

**解决**：如果是新的测试类型，在 [`cleanup-test-data.cjs`](./cleanup-test-data.cjs) 的 `TEST_OPENID_PREFIXES` 数组中添加对应前缀。

### Q2：CI 中清理步骤失败导致测试中断？

**排查**：

1. 查看 CI 日志中 "Clean test data" 步骤的输出
2. 如果是 `exit 1`（非友好跳过），说明脚本遇到真 bug：
   - 检查 `cleanup-test-data.cjs` 语法：`node --check scripts/cleanup-test-data.cjs`
   - 检查 `DATABASE_URL` 是否正确配置
3. 如果是 `exit 0` 但显示"跳过清理"：说明 MySQL 未就绪，属正常容错，不阻断后续步骤

### Q3：本地运行报 `DATABASE_URL` 未设置？

**原因**：脚本读取 `bff/.env`，若该文件不存在且未设置环境变量，会 `exit 1`。

**解决**：

```bash
# 方式 1：确保 bff/.env 存在（参考 bff/.env.example）
cp bff/.env.example bff/.env

# 方式 2：临时设置环境变量
$env:DATABASE_URL="mysql://root:password@localhost:3306/neighborhood_help"
node scripts/cleanup-test-data.cjs
```

### Q4：脚本误删了真实数据？

**不可能发生**（设计上）。脚本仅匹配 4 个测试 openid 前缀，真实用户的 openid 不会以这些前缀开头。

若仍有顾虑，先运行 dry-run 预览：

```bash
npm run cleanup:test-data   # 不带 --confirm，只预览不删除
```

确认匹配的数据都是测试数据后，再执行 `--confirm -y`。

### Q5：如何在 CI 中禁用清理步骤？

临时禁用：在 ci.yml 中注释掉 "Clean test data" 步骤即可。但建议保留，避免测试因脏数据残留而相互干扰。

---

## 相关文档

- [老板账号财务设置测试脚本](./test-boss-finance-settings.cjs) — 分佣配置诊断
- [Smoke 测试指南](./SMOKE_TEST_GUIDE.md) — 端到端冒烟测试
- [登录故障排查](./LOGIN_TROUBLESHOOTING.md) — 登录相关问题
- [测试运行指南](./TEST_RUNNER_GUIDE.md) — 测试框架使用
