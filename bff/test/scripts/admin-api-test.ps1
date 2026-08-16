# ============================================================
# 邻里互助 - 平台管理后台 API 测试脚本
# 运行方式: 在 PowerShell 中执行
#   cd d:\neighborhood-help\bff
#   .\test\scripts\admin-api-test.ps1
# ============================================================

param(
    [string]$BaseUrl = "http://localhost:3000/api/v1",
    [string]$AdminUserId = "2"
)

$ErrorActionPreference = "Stop"

# ===== 辅助函数 =====
function Write-Step($step, $msg) { Write-Host "`n━━━ ${step}: ${msg} ━━━" -ForegroundColor Cyan }
function Write-Ok($msg)         { Write-Host "  ✅ $msg" -ForegroundColor Green }
function Write-Warn($msg)       { Write-Host "  ⚠️  $msg" -ForegroundColor Yellow }
function Write-Err($msg)        { Write-Host "  ❌ $msg" -ForegroundColor Red }
function Write-Info($msg)       { Write-Host "  ℹ️  $msg" -ForegroundColor Gray }

function ApiGet($token, $path) {
    $headers = @{ "Authorization" = "Bearer $token" }
    return Invoke-RestMethod -Uri "$BaseUrl/$path" -Method Get -Headers $headers -TimeoutSec 10
}

function ApiPost($token, $path, $body) {
    $headers = @{ "Authorization" = "Bearer $token" }
    $json = $body | ConvertTo-Json -Depth 5
    return Invoke-RestMethod -Uri "$BaseUrl/$path" -Method Post -Headers $headers -ContentType "application/json" -Body $json -TimeoutSec 10
}

function ApiPut($token, $path, $body) {
    $headers = @{ "Authorization" = "Bearer $token" }
    $json = $body | ConvertTo-Json -Depth 5
    return Invoke-RestMethod -Uri "$BaseUrl/$path" -Method Put -Headers $headers -ContentType "application/json" -Body $json -TimeoutSec 10
}

function ApiPatch($token, $path, $body) {
    $headers = @{ "Authorization" = "Bearer $token" }
    $json = $body | ConvertTo-Json -Depth 5
    return Invoke-RestMethod -Uri "$BaseUrl/$path" -Method Patch -Headers $headers -ContentType "application/json" -Body $json -TimeoutSec 10
}

function ApiDelete($token, $path) {
    $headers = @{ "Authorization" = "Bearer $token" }
    return Invoke-RestMethod -Uri "$BaseUrl/$path" -Method Delete -Headers $headers -TimeoutSec 10
}

# ===== 脚本开始 =====
Write-Host "═══════════════════════════════════════════════" -ForegroundColor White
Write-Host "  邻里互助 - 平台管理后台 API 测试" -ForegroundColor White
Write-Host "  Base URL: $BaseUrl" -ForegroundColor Gray
Write-Host "═══════════════════════════════════════════════" -ForegroundColor White

$passCount = 0
$failCount = 0
$createdRuleIds = @()
$createdCategoryIds = @()

# ===== 1. 获取管理员 Token =====
Write-Step "1" "获取管理员 Token"

try {
    $loginBody = @{ userId = $AdminUserId } | ConvertTo-Json
    $loginResp = Invoke-RestMethod -Uri "$BaseUrl/auth/test-login" -Method Post -ContentType "application/json" -Body $loginBody -TimeoutSec 10
    $token = $loginResp.data.accessToken
    Write-Ok "Token 获取成功: $($token.Substring(0, [Math]::Min(50, $token.Length)))..."
    $passCount++
} catch {
    Write-Err "Token 获取失败: $_"
    Write-Info "请确保 BFF 已启动且数据库中存在 id=$AdminUserId 的 ADMIN 用户"
    exit 1
}

# ===== 2. 查看现有任务类别 =====
Write-Step "2" "查看现有任务类别"

try {
    $cats = ApiGet $token "admin/task-categories?includeInactive=true"
    Write-Ok "共 $($cats.data.Count) 个类别"
    foreach ($c in $cats.data) {
        $status = if ($c.isActive) { "启用" } else { "停用" }
        Write-Info "  [$($c.id)] $($c.code) - $($c.name) ($status, sort=$($c.sort))"
    }
    $passCount++
} catch {
    Write-Err "查询类别失败: $_"
    $failCount++
}

# ===== 3. 创建测试任务类别 =====
Write-Step "3" "创建测试任务类别"

try {
    $newCat = ApiPost $token "admin/task-categories" @{
        code     = "TEST_API"
        name     = "API测试类别"
        sort     = 99
        isActive = $true
    }
    Write-Ok "创建成功: [$($newCat.data.id)] $($newCat.data.code) - $($newCat.data.name)"
    $createdCategoryIds += $newCat.data.id
    $passCount++
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 409) {
        Write-Warn "类别编码已存在（可能是上次测试遗留），跳过"
    } else {
        Write-Err "创建失败: $_"
        $failCount++
    }
}

# ===== 4. 测试类别重复创建拒绝 =====
Write-Step "4" "测试类别重复创建拒绝"

try {
    ApiPost $token "admin/task-categories" @{
        code = "DELIVERY"
        name = "重复类别"
    }
    Write-Err "应该返回 409 但实际成功了"
    $failCount++
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 409) {
        Write-Ok "正确拒绝重复编码: HTTP 409"
        $passCount++
    } else {
        Write-Err "预期 409, 实际 $status"
        $failCount++
    }
}

# ===== 5. 更新任务类别 =====
Write-Step "5" "更新任务类别（改名+停用）"

if ($createdCategoryIds.Count -gt 0) {
    try {
        $catId = $createdCategoryIds[0]
        $updated = ApiPatch $token "admin/task-categories/$catId" @{
            name     = "API测试类别(已改名)"
            isActive = $false
        }
        Write-Ok "更新成功: name=$($updated.data.name), isActive=$($updated.data.isActive)"
        $passCount++
    } catch {
        Write-Err "更新失败: $_"
        $failCount++
    }
} else {
    Write-Info "跳过（未创建测试类别）"
}

# ===== 6. 查看现有分账规则 =====
Write-Step "6" "查看现有分账规则"

try {
    $rules = ApiGet $token "admin/profit-sharing-rules"
    Write-Ok "共 $($rules.data.Count) 条规则"
    foreach ($r in $rules.data) {
        $cat = if ($r.categoryName) { $r.categoryName } else { "全局默认" }
        $minMax = ""
        if ($r.minPlatformFee -ne $null) { $minMax += " min=$($r.minPlatformFee)" }
        if ($r.maxPlatformFee -ne $null) { $minMax += " max=$($r.maxPlatformFee)" }
        $status = if ($r.isActive) { "启用" } else { "停用" }
        Write-Info "  [$($r.id)] $($r.name) | $cat | 平台$($r.platformRate * 100)%/接单者$($r.helperRate * 100)% | priority=$($r.priority) | $status$minMax"
    }
    $passCount++
} catch {
    Write-Err "查询规则失败: $_"
    $failCount++
}

# ===== 7. 创建全局默认规则（如果不存在）=====
Write-Step "7" "创建全局默认分账规则"

try {
    $globalRule = ApiPost $token "admin/profit-sharing-rules" @{
        name         = "全局默认规则"
        platformRate = 0.1
        helperRate   = 0.9
        priority     = 0
    }
    Write-Ok "创建成功: [$($globalRule.data.id)] 平台$($globalRule.data.platformRate * 100)% / 接单者$($globalRule.data.helperRate * 100)%"
    $createdRuleIds += $globalRule.data.id
    $passCount++
} catch {
    $msg = $_.ErrorDetails.Message
    if ($msg -and $msg.Contains("已存在")) {
        Write-Warn "全局默认规则已存在，跳过"
    } else {
        Write-Err "创建失败: $_"
        $failCount++
    }
}

# ===== 8. 创建类别专属规则（家政保洁 15%）=====
Write-Step "8" "创建类别专属规则（家政保洁 15%）"

# 获取 CLEANING 类别 ID
try {
    $cats = ApiGet $token "admin/task-categories"
    $cleaningCat = $cats.data | Where-Object { $_.code -eq "CLEANING" } | Select-Object -First 1
    $cleaningId = $cleaningCat.id
    Write-Info "CLEANING 类别 ID: $cleaningId"
} catch {
    Write-Err "获取类别失败: $_"
    $cleaningId = $null
}

if ($cleaningId) {
    try {
        $rule = ApiPost $token "admin/profit-sharing-rules" @{
            name         = "家政保洁专属分账"
            categoryId   = $cleaningId
            platformRate = 0.15
            helperRate   = 0.85
            priority     = 10
        }
        Write-Ok "创建成功: [$($rule.data.id)] 平台$($rule.data.platformRate * 100)% / 接单者$($rule.data.helperRate * 100)%"
        $createdRuleIds += $rule.data.id
        $passCount++
    } catch {
        Write-Err "创建失败: $_"
        $failCount++
    }
}

# ===== 9. 创建带保底价和封顶价的规则 =====
Write-Step "9" "创建带保底价和封顶价的规则（跑腿 5%, min=5, max=50）"

try {
    $cats = ApiGet $token "admin/task-categories"
    $deliveryCat = $cats.data | Where-Object { $_.code -eq "DELIVERY" } | Select-Object -First 1
    $deliveryId = $deliveryCat.id
} catch {
    $deliveryId = $null
}

if ($deliveryId) {
    try {
        $rule = ApiPost $token "admin/profit-sharing-rules" @{
            name            = "跑腿保底规则"
            categoryId      = $deliveryId
            platformRate    = 0.05
            helperRate      = 0.95
            minPlatformFee  = 5
            maxPlatformFee  = 50
            priority        = 5
        }
        Write-Ok "创建成功: [$($rule.data.id)] 平台$($rule.data.platformRate * 100)% / 接单者$($rule.data.helperRate * 100)% / min=$($rule.data.minPlatformFee) / max=$($rule.data.maxPlatformFee)"
        $createdRuleIds += $rule.data.id
        $passCount++
    } catch {
        Write-Err "创建失败: $_"
        $failCount++
    }
}

# ===== 10. 创建限时活动规则 =====
Write-Step "10" "创建限时活动规则（春节跑腿 8%）"

if ($deliveryId) {
    try {
        $rule = ApiPost $token "admin/profit-sharing-rules" @{
            name         = "春节跑腿活动抽成"
            categoryId   = $deliveryId
            platformRate = 0.08
            helperRate   = 0.92
            validFrom    = "2026-01-25T00:00:00.000Z"
            validTo      = "2026-02-10T23:59:59.000Z"
            priority     = 100
        }
        Write-Ok "创建成功: [$($rule.data.id)] 平台$($rule.data.platformRate * 100)% / 有效期 $($rule.data.validFrom) ~ $($rule.data.validTo)"
        $createdRuleIds += $rule.data.id
        $passCount++
    } catch {
        Write-Err "创建失败: $_"
        $failCount++
    }
}

# ===== 11. 测试费率校验（之和不等于 1 应被拒绝）=====
Write-Step "11" "测试费率校验（platformRate + helperRate != 1）"

try {
    ApiPost $token "admin/profit-sharing-rules" @{
        name         = "错误规则"
        platformRate = 0.15
        helperRate   = 0.8
    }
    Write-Err "应该返回 400 但实际成功了"
    $failCount++
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 400) {
        Write-Ok "正确拒绝费率之和不等于 1: HTTP 400"
        $passCount++
    } else {
        Write-Err "预期 400, 实际 $status"
        $failCount++
    }
}

# ===== 12. 更新分账规则（调整比例）=====
Write-Step "12" "更新分账规则（调整抽成比例）"

if ($createdRuleIds.Count -gt 0) {
    $updateId = $createdRuleIds[0]
    try {
        $updated = ApiPut $token "admin/profit-sharing-rules/$updateId" @{
            name         = "全局默认规则(已调整)"
            platformRate = 0.12
            helperRate   = 0.88
            priority     = 0
        }
        Write-Ok "更新成功: $($updated.data.name) → 平台$($updated.data.platformRate * 100)% / 接单者$($updated.data.helperRate * 100)%"
        $passCount++
    } catch {
        Write-Err "更新失败: $_"
        $failCount++
    }
} else {
    Write-Info "跳过（无测试规则）"
}

# ===== 13. 停用规则 =====
Write-Step "13" "停用分账规则"

if ($createdRuleIds.Count -gt 1) {
    $deactivateId = $createdRuleIds[1]
    try {
        $updated = ApiPut $token "admin/profit-sharing-rules/$deactivateId" @{
            isActive = $false
        }
        Write-Ok "停用成功: $($updated.data.name) → isActive=$($updated.data.isActive)"
        $passCount++
    } catch {
        Write-Err "停用失败: $_"
        $failCount++
    }
} else {
    Write-Info "跳过（无测试规则）"
}

# ===== 14. 验证最终规则列表 =====
Write-Step "14" "验证最终规则列表"

try {
    $finalRules = ApiGet $token "admin/profit-sharing-rules"
    Write-Ok "共 $($finalRules.data.Count) 条规则"
    Write-Host ""
    Write-Host "  ┌─────┬──────────────────────┬────────────┬───────────┬─────────┬────────┐" -ForegroundColor Gray
    Write-Host "  │ ID  │ 名称                  │ 类别        │ 平台/接单  │ 优先级  │ 状态   │" -ForegroundColor Gray
    Write-Host "  ├─────┼──────────────────────┼────────────┼───────────┼─────────┼────────┤" -ForegroundColor Gray
    foreach ($r in $finalRules.data) {
        $cat = if ($r.categoryName) { $r.categoryName } else { "全局" }
        $rate = "$($r.platformRate * 100)%/$($r.helperRate * 100)%"
        $status = if ($r.isActive) { "启用" } else { "停用" }
        Write-Host ("  │ {0,-3} │ {1,-20} │ {2,-10} │ {3,-9} │ {4,-7} │ {5,-6} │" -f $r.id, $r.name, $cat, $rate, $r.priority, $status) -ForegroundColor White
    }
    Write-Host "  └─────┴──────────────────────┴────────────┴───────────┴─────────┴────────┘" -ForegroundColor Gray
    $passCount++
} catch {
    Write-Err "查询失败: $_"
    $failCount++
}

# ===== 15. 清理测试数据 =====
Write-Step "15" "清理测试数据"

# 删除测试创建的规则
foreach ($rid in $createdRuleIds) {
    try {
        ApiDelete $token "admin/profit-sharing-rules/$rid" | Out-Null
        Write-Ok "删除规则 $rid"
    } catch {
        Write-Warn "删除规则 $rid 失败: $_"
    }
}

# 恢复全局默认规则（如果被改了名）
try {
    $rules = ApiGet $token "admin/profit-sharing-rules"
    $globalRule = $rules.data | Where-Object { $_.categoryId -eq $null -and $_.isActive -eq $true } | Select-Object -First 1
    if ($globalRule -and $globalRule.name -ne "全局默认规则") {
        ApiPut $token "admin/profit-sharing-rules/$($globalRule.id)" @{
            name         = "全局默认规则"
            platformRate = 0.1
            helperRate   = 0.9
            priority     = 0
        } | Out-Null
        Write-Ok "恢复全局默认规则名称和比例"
    }
} catch {
    Write-Warn "恢复全局规则失败: $_"
}

# 删除测试创建的类别
foreach ($cid in $createdCategoryIds) {
    try {
        ApiDelete $token "admin/task-categories/$cid" | Out-Null
        Write-Ok "删除类别 $cid"
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        if ($status -eq 409) {
            # 有关联数据无法删除，改为停用
            try {
                ApiPatch $token "admin/task-categories/$cid" @{ isActive = $false } | Out-Null
                Write-Warn "类别 $cid 有关联数据，已改为停用"
            } catch {
                Write-Warn "停用类别 $cid 失败"
            }
        } else {
            Write-Warn "删除类别 $cid 失败: $_"
        }
    }
}

$passCount++

# ===== 汇总 =====
Write-Host "`n═══════════════════════════════════════════════" -ForegroundColor White
$total = $passCount + $failCount
Write-Host "  测试结果: $passCount / $total 通过, $failCount 失败" -ForegroundColor $(if ($failCount -eq 0) { "Green" } else { "Yellow" })
if ($failCount -eq 0) {
    Write-Host "  🎉 所有管理后台 API 测试通过！" -ForegroundColor Green
} else {
    Write-Host "  ⚠️  部分测试失败，请检查上述错误信息" -ForegroundColor Yellow
}
Write-Host "═══════════════════════════════════════════════`n" -ForegroundColor White
