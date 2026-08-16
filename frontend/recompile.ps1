# 清理旧编译产物并重新编译微信小程序
# 请在 PowerShell 或 CMD 中运行: powershell -ExecutionPolicy Bypass -File recompile.ps1

$ErrorActionPreference = "Continue"
$workDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $workDir

Write-Host "=== 步骤 1:清理旧编译产物 ===" -ForegroundColor Cyan
if (Test-Path "dist") {
    Remove-Item -Recurse -Force "dist" -ErrorAction SilentlyContinue
    Write-Host "  dist 目录已删除" -ForegroundColor Green
} else {
    Write-Host "  dist 目录不存在,跳过" -ForegroundColor Gray
}

Write-Host "`n=== 步骤 2:清理 pnpm 缓存 ===" -ForegroundColor Cyan
pnpm store prune 2>$null
Write-Host "  pnpm store 已清理" -ForegroundColor Green

Write-Host "`n=== 步骤 3:安装依赖 ===" -ForegroundColor Cyan
pnpm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "  依赖安装失败,请检查网络" -ForegroundColor Red
    exit 1
}
Write-Host "  依赖安装成功" -ForegroundColor Green

Write-Host "`n=== 步骤 4:编译微信小程序 ===" -ForegroundColor Cyan
pnpm build:mp-weixin
if ($LASTEXITCODE -ne 0) {
    Write-Host "  编译失败" -ForegroundColor Red
    exit 1
}
Write-Host "  编译成功" -ForegroundColor Green

Write-Host "`n=== 步骤 5:验证 finance-entry 是否已打入产物 ===" -ForegroundColor Cyan
$wxmlPath = "dist/build/mp-weixin/pages/user/profile.wxml"
if (Test-Path $wxmlPath) {
    $content = Get-Content $wxmlPath -Raw
    if ($content -match "finance") {
        Write-Host "  finance-entry 已打入产物 ✓" -ForegroundColor Green
        Write-Host "  下一步:在微信开发者工具中导入 dist/build/mp-weixin 目录" -ForegroundColor Yellow
    } else {
        Write-Host "  警告:编译产物中仍未找到 finance 关键字" -ForegroundColor Yellow
        Write-Host "  请检查 src/pages/user/profile.vue 是否已保存" -ForegroundColor Yellow
    }
} else {
    Write-Host "  profile.wxml 不存在,编译可能失败" -ForegroundColor Red
}

Write-Host "`n=== 完成 ===" -ForegroundColor Cyan
