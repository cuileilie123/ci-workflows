# 一键：单进程直连 WalletService 验证 AB-BA 死锁修复（跳过 HTTP）
# 前提：MySQL 已就绪（localhost:3306，账号/库与 bff/.env 对齐）。
# 无需启动 BFF HTTP 服务。
#
# 用法（在任意 PowerShell 窗口执行 cd bff 后）：
#   powershell -ExecutionPolicy Bypass -File .\scripts\run-abba-single-process.ps1
#
# 可选环境变量：
#   $env:ROUNDS=60     # 每方向并发轮数（默认 30）
#   $env:AMOUNT=10     # 固定转账金额，0 或未设=1~20 随机
#   $env:DEADLOCK_WAIT=45000  # 单条 transfer 超时 ms（默认 35000）

param()
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Set-Location (Join-Path $PSScriptRoot '..')

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host $msg -ForegroundColor Green }
function Fail($msg) { Write-Host $msg -ForegroundColor Red }

# ---- 1. 探测数据库：3306 + Prisma test connect ----
Step "1/4 探测 MySQL 是否就绪 (localhost:3306)..."
$t = New-Object System.Net.Sockets.TcpClient
try {
  $c = $t.BeginConnect('127.0.0.1', 3306, $null, $null)
  $ok = $c.AsyncWaitHandle.WaitOne(1500)
  if (-not ($ok -and $t.Connected)) { throw "3306 未监听，请先启动 MySQL（docker compose up -d mysql 或本地安装）" }
} finally { try { $t.Close() } catch {} }
Ok "✅ MySQL 端口 3306 已连通"

# ---- 2. setup：创建/重置用户 A/B 钱包，生成 env ps1 + 2h token ----
Step "2/4 准备测试数据：创建用户 A/B + 初始化钱包各 10000 元 + 清空之前的流水..."
node scripts/setup-abba-test-data.cjs
if ($LASTEXITCODE -ne 0) { throw "setup-abba-test-data.cjs 失败，exit=$LASTEXITCODE；如报错连不上库请检查 .env DATABASE_URL" }
Ok "✅ 准备完成：用户/钱包/token + _abba_env.ps1 已落盘"

# ---- 3. 跑核心：单进程直连 WalletService 并发转账（会把wallet.service的加锁顺序全量打到stdout）----
Step "3/4 启动单进程并发：同时跑 A→B + B→A 双向 transfer；会看到 wallet.service 每条 trace 级日志..."
& npx ts-node --project tsconfig.json scripts/verify-abba-nest.ts
$vExit = $LASTEXITCODE
if ($vExit -ne 0) {
  Fail "❌ verify-abba-nest.ts exit=$vExit；如为疑似死锁，请回看上方 `[SORT-KEY]/[LOCK-*]/[UPDATE-*]` 是否存在反序交叉"
  exit $vExit
}
Ok "✅ verify-abba-nest.ts 跑完：无死锁 + 总金额守恒（脚本自身已断言）"

# ---- 4. 额外校验：流水成对 + 最后 balanceAfter 匹配 wallets.balance ----
Step "4/4 额外校验：流水成对/金额一致/balanceAfter 与余额一致..."
node scripts/check-final-balance.cjs
if ($LASTEXITCODE -ne 0) { throw "check-final-balance 发现数据不一致" }

Write-Host ""
Ok "🎉 全部通过：AB-BA 死锁修复在单进程真实并发 + MySQL 行锁下验证完成。"
Write-Host "   回看 3/4 步的 stdout 日志：任意两组 A→B / B→A 交叉 trace 的锁顺序都是"
Write-Host "   先锁较小 userId（firstId）→ 再锁较大 userId（secondId）→ 同顺序 update，因此不会 AB-BA 持锁交叉。"
