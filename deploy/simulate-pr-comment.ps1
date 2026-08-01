<#
.SYNOPSIS
    本地模拟 GitHub Actions PR 评论逻辑
.DESCRIPTION
    在已有的 Docker 容器上模拟 workflow 步骤 5-8:
      5. 执行故障排查测试
      6. 解析 JSON 报告
      7. 生成 PR 评论 Markdown
      8. 在控制台渲染评论（模拟 GitHub 显示）
    无需安装 act，直接复用运行中的容器。
.PARAMETER SimulateFail
    模拟测试失败场景（跳过实际测试，使用预设的失败 JSON）
.PARAMETER SaveReport
    将 JSON 报告和评论 Markdown 保存到 deploy/ 目录
.PARAMETER PassRateThreshold
    通过率阈值 (%)，默认 90.0。通过率 >= 阈值时允许合并，否则阻断
.EXAMPLE
    .\simulate-pr-comment.ps1
    .\simulate-pr-comment.ps1 -SimulateFail
    .\simulate-pr-comment.ps1 -SaveReport
    .\simulate-pr-comment.ps1 -PassRateThreshold 95
#>

param(
    [switch]$SimulateFail,
    [switch]$SaveReport,
    [double]$PassRateThreshold = 90.0
)

$ErrorActionPreference = "Stop"
$Container = "nh-backup-scheduler"
$ProjectDir = "d:\neighborhood-help"
$FailJsonPath = Join-Path $ProjectDir "deploy\test-fail-scenario.json"

# ---------- 工具函数 ----------

function Write-Step($num, $title) {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  Step $num : $title" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
}

function Write-OK($msg) {
    Write-Host "  [OK] $msg" -ForegroundColor Green
}

function Write-Info($msg) {
    Write-Host "  [INFO] $msg" -ForegroundColor Gray
}

function Write-Err($msg) {
    Write-Host "  [ERROR] $msg" -ForegroundColor Red
}

# ---------- 前置检查 ----------

Write-Host ""
Write-Host "============================================" -ForegroundColor Yellow
Write-Host "  GitHub Actions PR 评论逻辑 - 本地模拟器" -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor Yellow

Write-Step 0 "前置检查"
$containerStatus = docker inspect --format '{{.State.Status}}' $Container 2>$null
if ($containerStatus -ne "running") {
    Write-Err "容器 $Container 未运行 (状态: $containerStatus)"
    Write-Host "  请先启动: docker compose -f docker-compose.yml -f docker-compose.backup.yml up -d backup-scheduler" -ForegroundColor Yellow
    exit 1
}
Write-OK "容器 $Container 正在运行"

$scripts = @("test-fault-recovery.sh", "parse_test_report.py", "pr-comment.py")
foreach ($s in $scripts) {
    $path = Join-Path $ProjectDir "scripts\$s"
    if (Test-Path $path) {
        Write-OK "脚本存在: $s"
    } else {
        Write-Err "脚本缺失: $s"
        exit 1
    }
}

# ---------- Step 5: 执行测试 ----------

Write-Step 5 "执行故障排查测试"

if ($SimulateFail) {
    Write-Info "跳过实际测试，使用预设的失败 JSON 数据"
    if (-not (Test-Path $FailJsonPath)) {
        Write-Err "失败场景 JSON 文件不存在: $FailJsonPath"
        exit 1
    }
    docker cp $FailJsonPath "${Container}:/tmp/test-report.json"
    $testExitCode = 1
    $duration = 285
    # 从预设 JSON 提取通过率
    $tempFail = Join-Path $env:TEMP "test-fail-report.json"
    docker cp "${Container}:/tmp/test-report.json" $tempFail
    $failReport = Get-Content $tempFail -Raw -Encoding UTF8 | ConvertFrom-Json
    $passRate = [double]$failReport.summary.pass_rate
    Remove-Item $tempFail
    Write-Info "已加载预设失败数据 (通过率: $passRate%, 2 个失败场景)"
} else {
    Write-Info "正在执行 37 项故障排查测试 (约 2-5 分钟)..."
    $startTime = Get-Date

    $testOutput = docker exec $Container bash -c "source /tmp/backup-env.sh && bash /scripts/test-fault-recovery.sh" 2>&1
    $testExitCode = $LASTEXITCODE

    $endTime = Get-Date
    $duration = [math]::Round(($endTime - $startTime).TotalSeconds)

    Write-Info "测试退出码: $testExitCode"
    Write-Info "测试耗时: ${duration}s"

    $tempLog = Join-Path $env:TEMP "test-output.log"
    $testOutput | Out-File -FilePath $tempLog -Encoding utf8
    docker cp $tempLog "${Container}:/tmp/test.log"
    Remove-Item $tempLog

    # ---------- Step 6: 解析 JSON 报告 ----------
    Write-Step 6 "解析 JSON 报告"
    # 在容器内生成 JSON 文件，避免 PowerShell 重定向编码问题
    docker exec $Container python3 /scripts/parse_test_report.py --file /tmp/test.log --json --duration $duration --output /tmp/test-report.json 2>$null
    $tempReport = Join-Path $env:TEMP "test-report.json"
    docker cp "${Container}:/tmp/test-report.json" $tempReport
    Write-OK "JSON 报告已生成"

    $report = Get-Content $tempReport -Raw -Encoding UTF8 | ConvertFrom-Json
    $passRate = [double]$report.summary.pass_rate
    $statusColor = if ($report.overall_status -eq 'PASS') {'Green'} else {'Red'}
    Write-Host "  状态:   $($report.overall_status)" -ForegroundColor $statusColor
    Write-Host "  通过:   $($report.summary.pass)/$($report.summary.total_items)"
    Write-Host "  失败:   $($report.summary.fail)"
    Write-Host "  通过率: $($report.summary.pass_rate)%"
}

# ---------- Step 7: 生成 PR 评论 ----------

Write-Step 7 "生成 PR 评论 (HTML 表格)"

$commentOutput = docker exec $Container python3 /scripts/pr-comment.py --report /tmp/test-report.json --html 2>&1
Write-OK "评论已生成 (HTML 表格格式)"

# ---------- Step 8: 模拟 GitHub PR 评论显示 ----------

Write-Step 8 "模拟 GitHub PR 评论显示"

Write-Host ""
Write-Host "+-----------------------------------------------------------+" -ForegroundColor DarkGray
Write-Host "|  GitHub Pull Request #$((Get-Random -Min 100 -Max 999)) - Comments                    |" -ForegroundColor DarkGray
Write-Host "+-----------------------------------------------------------+" -ForegroundColor DarkGray
Write-Host "|  github-actions[bot] commented now                        |" -ForegroundColor DarkGray
Write-Host "+-----------------------------------------------------------+" -ForegroundColor DarkGray
Write-Host "|"

$commentLines = $commentOutput -split "`n"
$firstLine = $true
foreach ($line in $commentLines) {
    if ($line -match "^<!--") { continue }
    if ($firstLine -and $line.Trim() -eq "") { continue }
    $firstLine = $false
    Write-Host "|  $line"
}

Write-Host "|"
Write-Host "+-----------------------------------------------------------+" -ForegroundColor DarkGray
Write-Host ""

# ---------- 保存报告 ----------

if ($SaveReport) {
    $reportPath = Join-Path $ProjectDir "deploy\test-report.json"
    $commentPath = Join-Path $ProjectDir "deploy\pr-comment.md"
    $tempReport = Join-Path $env:TEMP "test-report.json"
    if (Test-Path $tempReport) {
        Copy-Item $tempReport $reportPath -Force
    } elseif ($SimulateFail) {
        Copy-Item $FailJsonPath $reportPath -Force
    }
    $commentOutput | Out-File -FilePath $commentPath -Encoding utf8
    Write-Host "  报告已保存:" -ForegroundColor Green
    Write-Host "    JSON:  $reportPath"
    Write-Host "    评论:  $commentPath"
}

# ---------- 总结 ----------

Write-Host ""
Write-Host "============================================" -ForegroundColor Yellow
Write-Host "  模拟结果总结" -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor Yellow

$meetsThreshold = $passRate -ge $PassRateThreshold

Write-Host "  通过率:      $passRate%" -ForegroundColor $(if ($meetsThreshold) {'Green'} else {'Red'})
Write-Host "  阈值:        $PassRateThreshold%" -ForegroundColor Gray
Write-Host ""

if ($meetsThreshold) {
    Write-Host "  PR 评论状态: PASS" -ForegroundColor Green
    Write-Host "  CI/CD 行为:   通过率达标，评论更新为通过状态" -ForegroundColor Green
    Write-Host "  PR 门禁:      允许合并" -ForegroundColor Green
    if ($testExitCode -ne 0) {
        Write-Host "  [WARN]       存在失败项，但通过率达标，不阻断合并" -ForegroundColor Yellow
    }
    $exitCode = 0
} else {
    Write-Host "  PR 评论状态: FAIL" -ForegroundColor Red
    Write-Host "  CI/CD 行为:   通过率未达标，评论包含失败详情" -ForegroundColor Red
    Write-Host "  PR 门禁:      阻断合并" -ForegroundColor Red
    $exitCode = 1
}

Write-Host ""
Write-Host "  命令选项:" -ForegroundColor Gray
Write-Host "    正常模式:      .\deploy\simulate-pr-comment.ps1" -ForegroundColor Gray
Write-Host "    失败模拟:      .\deploy\simulate-pr-comment.ps1 -SimulateFail" -ForegroundColor Gray
Write-Host "    保存报告:      .\deploy\simulate-pr-comment.ps1 -SaveReport" -ForegroundColor Gray
Write-Host "    自定义阈值:    .\deploy\simulate-pr-comment.ps1 -PassRateThreshold 95" -ForegroundColor Gray
Write-Host "    阈值+失败模拟: .\deploy\simulate-pr-comment.ps1 -SimulateFail -PassRateThreshold 100" -ForegroundColor Gray
Write-Host "============================================" -ForegroundColor Yellow

exit $exitCode
