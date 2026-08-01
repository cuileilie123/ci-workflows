<#
.SYNOPSIS
    将 PR 评论结果自动写入本地 JSON 文件
.DESCRIPTION
    执行测试 → 解析报告 → 生成评论 → 合并写入单个 JSON 文件
    JSON 包含测试报告数据 + 评论 Markdown + 元信息
    适合 CI/CD 归档或本地追踪测试历史
.PARAMETER SimulateFail
    模拟测试失败场景
.PARAMETER OutputDir
    输出目录 (默认: deploy\reports)
.EXAMPLE
    .\save-pr-comment-json.ps1
    .\save-pr-comment-json.ps1 -SimulateFail
    .\save-pr-comment-json.ps1 -OutputDir D:\reports
#>

param(
    [switch]$SimulateFail,
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"
$Container = "nh-backup-scheduler"
$ProjectDir = "d:\neighborhood-help"
if (-not $OutputDir) { $OutputDir = Join-Path $ProjectDir "deploy\reports" }
$FailJsonPath = Join-Path $ProjectDir "deploy\test-fail-scenario.json"

# ---------- 工具函数 ----------

function Write-Info($msg) { Write-Host "  [INFO] $msg" -ForegroundColor Gray }
function Write-OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "  [ERROR] $msg" -ForegroundColor Red }

# ---------- 前置检查 ----------

Write-Host ""
Write-Host "=== PR 评论结果 JSON 导出器 ===" -ForegroundColor Yellow

$containerStatus = docker inspect --format '{{.State.Status}}' $Container 2>$null
if ($containerStatus -ne "running") {
    Write-Err "容器 $Container 未运行"
    exit 1
}

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    Write-Info "创建输出目录: $OutputDir"
}

# ---------- 执行测试或加载模拟数据 ----------

if ($SimulateFail) {
    Write-Info "加载预设失败数据..."
    docker cp $FailJsonPath "${Container}:/tmp/test-report.json"
    $duration = 285
    $testExitCode = 1
} else {
    Write-Info "执行 37 项故障排查测试..."
    $startTime = Get-Date
    $testOutput = docker exec $Container bash -c "source /tmp/backup-env.sh && bash /scripts/test-fault-recovery.sh" 2>&1
    $testExitCode = $LASTEXITCODE
    $duration = [math]::Round(((Get-Date) - $startTime).TotalSeconds)
    Write-Info "测试耗时: ${duration}s, 退出码: $testExitCode"

    # 生成 JSON 报告
    $tempLog = Join-Path $env:TEMP "test-output.log"
    $testOutput | Out-File -FilePath $tempLog -Encoding utf8
    docker cp $tempLog "${Container}:/tmp/test.log"
    Remove-Item $tempLog
    docker exec $Container python3 /scripts/parse_test_report.py --file /tmp/test.log --json --duration $duration --output /tmp/test-report.json 2>$null
}

# ---------- 生成 PR 评论 Markdown ----------

$commentMarkdown = docker exec $Container python3 /scripts/pr-comment.py --report /tmp/test-report.json 2>&1

# ---------- 复制 JSON 到宿主机并解析 ----------

$tempReport = Join-Path $env:TEMP "test-report.json"
docker cp "${Container}:/tmp/test-report.json" $tempReport
$report = Get-Content $tempReport -Raw -Encoding UTF8 | ConvertFrom-Json

# ---------- 合并写入单个 JSON 文件 ----------

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$datePath = Get-Date -Format "yyyy-MM-dd"
$fileName = "pr-comment-$timestamp.json"
$filePath = Join-Path $OutputDir $fileName

# 构建合并 JSON
$result = [ordered]@{
    export_time    = (Get-Date).ToString("o")
    export_mode    = if ($SimulateFail) { "simulate_fail" } else { "live_test" }
    test_duration  = $duration
    comment_markdown = $commentMarkdown
    report         = $report
}

$resultJson = $result | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($filePath, $resultJson, [System.Text.Encoding]::UTF8)

# ---------- 同时保存最新一份 ----------

$latestPath = Join-Path $OutputDir "pr-comment-latest.json"
[System.IO.File]::WriteAllText($latestPath, $resultJson, [System.Text.Encoding]::UTF8)

# ---------- 输出摘要 ----------

Write-Host ""
Write-Host "=== 导出结果 ===" -ForegroundColor Cyan
Write-Host "  状态:       $($report.overall_status)" -ForegroundColor $(if ($report.overall_status -eq 'PASS') {'Green'} else {'Red'})
Write-Host "  通过:       $($report.summary.pass)/$($report.summary.total_items)"
Write-Host "  通过率:     $($report.summary.pass_rate)%"
Write-Host "  耗时:       ${duration}s"
Write-Host ""
Write-Host "  JSON 文件:  $filePath" -ForegroundColor Green
Write-Host "  最新副本:   $latestPath" -ForegroundColor Green

# ---------- 历史记录索引 ----------

$indexFile = Join-Path $OutputDir "index.json"
$history = @()
if (Test-Path $indexFile) {
    $history = Get-Content $indexFile -Raw -Encoding UTF8 | ConvertFrom-Json
}

$entry = [ordered]@{
    timestamp   = (Get-Date).ToString("o")
    file        = $fileName
    status      = $report.overall_status
    pass        = $report.summary.pass
    total       = $report.summary.total_items
    pass_rate   = $report.summary.pass_rate
    duration    = $duration
    mode        = if ($SimulateFail) { "simulate" } else { "live" }
}

$history = @($entry) + $history
$historyJson = $history | ConvertTo-Json -Depth 5
if ($history.Count -eq 1) { $historyJson = "[$historyJson]" }
[System.IO.File]::WriteAllText($indexFile, $historyJson, [System.Text.Encoding]::UTF8)

Write-Host "  历史索引:   $indexFile ($($history.Count) 条记录)" -ForegroundColor Green
Write-Host ""

exit $testExitCode
