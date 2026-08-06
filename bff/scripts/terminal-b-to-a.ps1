# 【终端 B】循环向用户 A 发起 B → A 转账（与终端 A 同时启动，制造 AB-BA 经典交叉）
#
# 使用方法（与 terminal-a-to-b.ps1 对称）：
#   1. BFF 服务已启动
#   2. 新打开第二个 PowerShell 窗口
#   3. 粘贴 setup-abba-test-data.cjs 输出的 6 行 `$env:...` 命令（与终端 A 粘贴的完全一样）
#   4. 执行：
#        & .\scripts\terminal-b-to-a.ps1
#
# 可选环境变量：
#   $env:ITER / $env:MIN_MS / $env:MAX_MS / $env:AMOUNT
# （变量含义与 terminal-a-to-b.ps1 完全相同）

param()
$ErrorActionPreference = "Continue"

$iter     = if ($env:ITER)     { [int]$env:ITER }     else { 50 }
$minMs    = if ($env:MIN_MS)   { [int]$env:MIN_MS }   else { 10 }
$maxMs    = if ($env:MAX_MS)   { [int]$env:MAX_MS }   else { 150 }
$fixedAmt = if ($env:AMOUNT)   { [decimal]$env:AMOUNT } else { 0 }

$base    = $env:BASE_URL    ?? "http://localhost:3000"
$bToken  = $env:USER_B_TOKEN
$aUserId = $env:USER_A_ID
$bUserId = $env:USER_B_ID

if (-not $bToken -or -not $aUserId -or -not $bUserId) {
  Write-Host "❌ 缺少环境变量，请先执行 node scripts/setup-abba-test-data.cjs，并把输出的 6 行 `$env:...` 粘贴到本终端。" -ForegroundColor Red
  exit 2
}

$url = "$base/api/v1/wallet/transfer"
$hdr = @{
  "Authorization" = "Bearer $bToken"
  "Content-Type"  = "application/json; charset=utf-8"
}

Write-Host "`n======== [终端 B] B→A 转账发起端 ========" -ForegroundColor Magenta
Write-Host "BASE_URL=$base   USER_B=$bUserId   USER_A=$aUserId"
Write-Host "ITER=$iter   INTERVAL=${minMs}~${maxMs}ms   AMOUNT=$(if ($fixedAmt -gt 0) { $fixedAmt } else { '1~20 随机' })"
Write-Host "----------------------------------------------------------"

$ok = 0; $fail = 0; $deadlock = 0
$rand = [Random]::new()

for ($i = 1; $i -le $iter; $i++) {
  $amt  = if ($fixedAmt -gt 0) { $fixedAmt } else { $rand.Next(1, 21) }
  $body = @{
    toUserId    = $aUserId
    amount      = [decimal]$amt
    description = "ABBA-HTTP B->A #$i"
  } | ConvertTo-Json -Compress

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $resp = Invoke-RestMethod -Method Post -Uri $url -Headers $hdr -Body $body `
              -TimeoutSec 40 -SkipHttpErrorCheck -StatusCodeVariable sc
    $cost = $sw.ElapsedMilliseconds
    if ($sc -ge 200 -and $sc -lt 300) {
      $ok++
      Write-Host ("{0,4} | {1,-3} | {2,5}ms | {3,4} | B→A OK: {4}" -f $i,$sc,$cost,$amt,($resp.message -join '')) -ForegroundColor Green
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
      Write-Host "   💡 请重新运行 setup-abba-test-data.cjs 并粘贴新的 `$env:USER_B_TOKEN" -ForegroundColor Red
      break
    }
    $fail++
    Write-Host ("{0,4} | EXCEPTION | {1,5}ms | {2,4} | {3}" -f $i,$cost,$amt,$msg) -ForegroundColor Yellow
  }
  $sleepMs = $rand.Next($minMs, $maxMs + 1)
  Start-Sleep -Milliseconds $sleepMs
}

Write-Host "`n======== [终端 B] 完成 ========" -ForegroundColor Magenta
Write-Host ("成功 {0} / 失败 {1} / 疑似死锁* {2}（共 {3}）" -f $ok,$fail,$deadlock,$iter) -ForegroundColor White
Write-Host "两边都跑完后，执行 node scripts/check-final-balance.cjs 校验总余额守恒 & 流水成对。"
