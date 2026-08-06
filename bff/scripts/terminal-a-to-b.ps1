# 【终端 A】循环向用户 B 发起 A → B 转账（模拟 AB-BA 交叉的 A 侧）
#
# 使用方法（严格按顺序）：
#   1. 在本机启动 BFF 服务：  (在 bff 目录下)
#        npm run start:dev
#   2. 打开第一个 PowerShell 终端，执行：
#        node scripts/setup-abba-test-data.cjs
#      复制输出中以 `$env:...` 开头的 6 行命令
#   3. 将这 6 行粘贴到本终端（终端 A）执行，确认变量设置成功
#        echo $env:USER_A_ID, $env:USER_B_ID, $env:BASE_URL
#   4. 在本终端执行本脚本：
#        powershell -ExecutionPolicy Bypass -File scripts/terminal-a-to-b.ps1
#        # 或直接： & .\scripts\terminal-a-to-b.ps1
#   5. 同时打开终端 B，执行 terminal-b-to-a.ps1，让两边同时跑
#
# 可选环境变量覆盖：
#   $env:ITER=50          # 转账次数（默认 50）
#   $env:MIN_MS=20        # 每次请求间隔最小 ms（默认 10）
#   $env:MAX_MS=120       # 每次请求间隔最大 ms（默认 150）
#   $env:AMOUNT=10        # 固定每次转账金额（默认 1~20 随机）

param()
$ErrorActionPreference = "Continue"

# ---- 基础参数 ----
$iter     = if ($env:ITER)     { [int]$env:ITER }     else { 50 }
$minMs    = if ($env:MIN_MS)   { [int]$env:MIN_MS }   else { 10 }
$maxMs    = if ($env:MAX_MS)   { [int]$env:MAX_MS }   else { 150 }
$fixedAmt = if ($env:AMOUNT)   { [decimal]$env:AMOUNT } else { 0 }

$base    = $env:BASE_URL    ?? "http://localhost:3000"
$aToken  = $env:USER_A_TOKEN
$bUserId = $env:USER_B_ID
$aUserId = $env:USER_A_ID

if (-not $aToken -or -not $bUserId -or -not $aUserId) {
  Write-Host "❌ 缺少环境变量，请先执行：" -ForegroundColor Red
  Write-Host "   node scripts/setup-abba-test-data.cjs"
  Write-Host "   然后把输出的 6 行 `$env:...` 粘贴到本终端再运行本脚本。"
  exit 2
}

$url   = "$base/api/v1/wallet/transfer"
$hdr   = @{
  "Authorization" = "Bearer $aToken"
  "Content-Type"  = "application/json; charset=utf-8"
}

Write-Host "`n======== [终端 A] A→B 转账发起端 ========" -ForegroundColor Cyan
Write-Host "BASE_URL=$base   USER_A=$aUserId   USER_B=$bUserId"
Write-Host "ITER=$iter   INTERVAL=${minMs}~${maxMs}ms   AMOUNT=$(if ($fixedAmt -gt 0) { $fixedAmt } else { '1~20 随机' })"
Write-Host "每个请求都会打印：`n  序号 | HTTP状态码 | 耗时ms | 金额 | 响应摘要"
Write-Host "----------------------------------------------------------"

$ok = 0
$fail = 0
$deadlock = 0
$rand = [Random]::new()

for ($i = 1; $i -le $iter; $i++) {
  $amt = if ($fixedAmt -gt 0) { $fixedAmt } else { $rand.Next(1, 21) }
  $body = @{
    toUserId    = $bUserId
    amount      = [decimal]$amt
    description = "ABBA-HTTP A->B #$i"
  } | ConvertTo-Json -Compress

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $resp = Invoke-RestMethod -Method Post -Uri $url -Headers $hdr -Body $body `
              -TimeoutSec 40 -SkipHttpErrorCheck -StatusCodeVariable sc
    $cost = $sw.ElapsedMilliseconds
    if ($sc -ge 200 -and $sc -lt 300) {
      $ok++
      Write-Host ("{0,4} | {1,-3} | {2,5}ms | {3,4} | A→B OK: {4}" -f $i,$sc,$cost,$amt,($resp.message -join '')) -ForegroundColor Green
    } else {
      $fail++
      $flat = ($resp | Out-String).Trim() -replace "`r?`n","  "
      if ($flat -match '[Dd]eadlock|lock wait timeout') { $deadlock++ }
      Write-Host ("{0,4} | {1,-3} | {2,5}ms | {3,4} | FAIL: {4}" -f $i,$sc,$cost,$amt,$flat) -ForegroundColor Yellow
    }
  } catch {
    $cost = $sw.ElapsedMilliseconds
    $msg  = $_.Exception.Message
    if ($msg -match '[Dd]eadlock|lock wait timeout') { $deadlock++ }
    if ($msg -match '401|403') {
      Write-Host ("{0,4} | UNAUTH | {1,5}ms | {2,4} | {3}" -f $i,$cost,$amt,$msg) -ForegroundColor Red
      Write-Host "   💡 请重新运行 setup-abba-test-data.cjs 并粘贴新的 `$env:USER_A_TOKEN" -ForegroundColor Red
      break
    }
    $fail++
    Write-Host ("{0,4} | EXCEPTION | {1,5}ms | {2,4} | {3}" -f $i,$cost,$amt,$msg) -ForegroundColor Yellow
  }

  $sleepMs = $rand.Next($minMs, $maxMs + 1)
  Start-Sleep -Milliseconds $sleepMs
}

Write-Host "`n======== [终端 A] 完成 ========" -ForegroundColor Cyan
Write-Host ("成功 {0} / 失败 {1} / 疑似死锁* {2}（共 {3}）" -f $ok,$fail,$deadlock,$iter) -ForegroundColor White
Write-Host "* 疑似死锁 = 响应或异常中出现 Deadlock / lock wait timeout / 或请求超时。"
Write-Host "  真实死锁在 MySQL 中会被主动 killed（死锁回滚），HTTP 层通常是 500 + message 含 Deadlock；" -ForegroundColor DarkGray
Write-Host "  若没有死锁信息但请求很慢，多半是锁等待队列堆积（修复生效后的表现，不会真死锁）。" -ForegroundColor DarkGray
