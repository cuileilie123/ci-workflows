#
# ============================================================
# 社区邻里有偿互助平台 - 一键部署脚本 (PowerShell)
# ============================================================
#
# 用法 (PowerShell):
#   .\deploy.ps1                          # 标准交互部署
#   .\deploy.ps1 -NoPrompt                # 无交互部署
#   .\deploy.ps1 -Force                   # 强制重新配置
#   .\deploy.ps1 -SkipMigrate             # 跳过数据库迁移
#   .\deploy.ps1 -SkipBackup              # 跳过备份配置
#   .\deploy.ps1 -Cleanup                 # 清理所有资源
#   Get-Help .\deploy.ps1                 # 查看帮助
#
# ============================================================

[CmdletBinding()]
param(
    [switch]$NoPrompt,
    [switch]$Force,
    [switch]$SkipBuild,
    [switch]$SkipMigrate,
    [switch]$SkipBackup,
    [switch]$Cleanup,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

# ==================== 全局变量 ====================
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = $ScriptDir
$EnvFile = Join-Path $ProjectDir ".env"
$EnvExample = Join-Path $ProjectDir ".env.example"
$ComposeFile = Join-Path $ProjectDir "docker-compose.yml"
$LogFile = Join-Path $ProjectDir "deploy-$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

# ==================== 颜色输出 ====================
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White",
        [switch]$Bold
    )
    $style = if ($Bold) { "Bold" } else { "Normal" }
    Write-Host $Message -ForegroundColor $Color
    Add-Content -Path $LogFile -Value $Message
}

function Write-Step {
    param([string]$Message)
    $separator = "━━━" * 20
    Write-ColorOutput "`n$separator" "Cyan" $true
    Write-ColorOutput "  $Message" "Cyan" $true
    Write-ColorOutput "$separator`n" "Cyan" $true
}

function Write-Header {
    $header = @"

╔══════════════════════════════════════════════════════════════╗
║           社区邻里有偿互助平台 - 一键部署                   ║
║                    Neighborhood Help Platform               ║
╠══════════════════════════════════════════════════════════════╣
║  时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')                                        ║
╚══════════════════════════════════════════════════════════════╝

"@
    Write-ColorOutput $header "Cyan" $true
}

# ==================== 日志初始化 ====================
function Initialize-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] $Message"
    Write-ColorOutput $logEntry "Gray"
    Add-Content -Path $LogFile -Value $logEntry
}

# ==================== 帮助 ====================
function Show-Help {
    $helpText = @"
社区邻里有偿互助平台 - 一键部署脚本

用法: .\deploy.ps1 [参数]

参数:
  -NoPrompt       无交互模式（使用默认值）
  -Force          强制覆盖已有 .env 配置
  -SkipBuild      跳过镜像拉取
  -SkipMigrate    跳过数据库迁移
  -SkipBackup     跳过备份调度器配置
  -Cleanup        清理所有 Docker 资源
  -Help           显示本帮助

示例:
  .\deploy.ps1                       # 标准交互部署
  .\deploy.ps1 -NoPrompt             # 无交互部署
  .\deploy.ps1 -Force                # 重新配置
  .\deploy.ps1 -SkipMigrate          # 跳过迁移
  .\deploy.ps1 -Cleanup              # 清理资源

部署流程:
  1. 环境检查（Docker / 磁盘 / 网络）
  2. 环境变量配置（.env 文件）
  3. 目录结构初始化
  4. Docker 镜像加速配置
  5. 服务启动
  6. 数据库初始化
  7. 备份调度器配置
  8. 健康检查
  9. 生成部署报告

"@
    Write-ColorOutput $helpText "White"
}

# ==================== 步骤 1: 环境检查 ====================
function Check-Prerequisites {
    Write-Step "步骤 1/9: 环境检查"
    
    # 操作系统
    $osInfo = [System.Environment]::OSVersion
    Initialize-Log "操作系统: Windows $($osInfo.Version)"
    
    # Docker
    try {
        $dockerVersion = docker version --format '{{.Server.Version}}' 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Docker daemon not running"
        }
        Initialize-Log "Docker 版本: $dockerVersion"
        Write-ColorOutput "  [OK] Docker 运行中 ($dockerVersion)" "Green"
    } catch {
        Write-ColorOutput "  [FAIL] Docker 未安装或未运行！" "Red" $true
        Write-ColorOutput "  请安装 Docker Desktop: https://docs.docker.com/desktop/" "Yellow"
        exit 1
    }
    
    # Docker Compose
    try {
        $composeVersion = docker compose version
        $composeCmd = "docker compose"
        Initialize-Log "Docker Compose: $composeVersion"
        Write-ColorOutput "  [OK] Docker Compose 可用" "Green"
    } catch {
        Write-ColorOutput "  [FAIL] Docker Compose 不可用" "Red" $true
        exit 1
    }
    
    # Node.js
    try {
        $nodeVersion = node --version 2>$null
        Initialize-Log "Node.js: $nodeVersion"
        Write-ColorOutput "  [OK] Node.js $nodeVersion" "Green"
    } catch {
        Write-ColorOutput "  [WARN] Node.js 未安装（如需迁移请先安装）" "Yellow"
    }
    
    # pnpm
    try {
        $pnpmVersion = pnpm --version 2>$null
        Initialize-Log "pnpm: $pnpmVersion"
        Write-ColorOutput "  [OK] pnpm $pnpmVersion" "Green"
    } catch {
        Write-ColorOutput "  [WARN] pnpm 未安装" "Yellow"
    }
    
    # 磁盘空间
    $drive = Get-PSDrive -Name (Get-Location).Drive.Name
    $freeGB = [math]::Round($drive.Free / 1GB, 1)
    Initialize-Log "磁盘可用: ${freeGB}GB"
    if ($freeGB -lt 5) {
        Write-ColorOutput "  [WARN] 磁盘剩余不足 5GB (${freeGB}GB)" "Yellow"
    } else {
        Write-ColorOutput "  [OK] 磁盘空间充足 (${freeGB}GB)" "Green"
    }
    
    # 项目文件
    if (-not (Test-Path $ComposeFile)) {
        Write-ColorOutput "  [FAIL] 未找到 docker-compose.yml" "Red" $true
        exit 1
    }
    Write-ColorOutput "  [OK] 项目目录: $ProjectDir" "Green"
    
    return @{ ComposeCmd = $composeCmd }
}

# ==================== 步骤 2: 环境变量配置 ====================
function Setup-Environment {
    param([bool]$Interactive)
    
    Write-Step "步骤 2/9: 环境变量配置"
    
    if ((Test-Path $EnvFile) -and (-not $Force)) {
        if ($Interactive) {
            Write-ColorOutput "  .env 文件已存在，是否重新配置？[y/N]" "Yellow"
            $reply = Read-Host "  输入"
            if ($reply -ne "y" -and $reply -ne "Y") {
                Initialize-Log "跳过环境变量配置"
                return
            }
        } else {
            Initialize-Log ".env 已存在，跳过"
            return
        }
    }
    
    if (-not (Test-Path $EnvExample)) {
        Write-ColorOutput "  [FAIL] 未找到 .env.example 模板" "Red" $true
        exit 1
    }
    
    Copy-Item $EnvExample $EnvFile -Force
    Initialize-Log "已从模板创建 .env"
    
    # 生成随机密钥
    function New-Secret {
        $bytes = New-Object byte[] 48
        [System.Security.Cryptography.RNGCryptoServiceProvider]::GetBytes($bytes)
        return [Convert]::ToBase64String($bytes)
    }
    
    $jwtSecret = New-Secret
    $jwtRefreshSecret = New-Secret
    
    if ($Interactive) {
        Write-Host "`n  请配置环境变量（直接回车使用默认值）:`n" -ForegroundColor Cyan
        
        $mysqlPassword = Read-Host "  MySQL root 密码" 
        if ([string]::IsNullOrWhiteSpace($mysqlPassword)) { $mysqlPassword = "root123" }
        
        $inputJwt = Read-Host "  JWT Secret (留空自动生成)"
        if (-not [string]::IsNullOrWhiteSpace($inputJwt)) { $jwtSecret = $inputJwt }
        
        $inputJwtRefresh = Read-Host "  JWT Refresh Secret (留空自动生成)"
        if (-not [string]::IsNullOrWhiteSpace($inputJwtRefresh)) { $jwtRefreshSecret = $inputJwtRefresh }
        
        $wxAppId = Read-Host "  微信 AppID"
        if ([string]::IsNullOrWhiteSpace($wxAppId)) { $wxAppId = "your_appid_here" }
        
        $wxSecret = Read-Host "  微信 AppSecret"
        if ([string]::IsNullOrWhiteSpace($wxSecret)) { $wxSecret = "your_secret_here" }
        
        $cosSecretId = Read-Host "  腾讯云 COS SecretId"
        if ([string]::IsNullOrWhiteSpace($cosSecretId)) { $cosSecretId = "your_cos_secret_id" }
        
        $cosSecretKey = Read-Host "  腾讯云 COS SecretKey"
        if ([string]::IsNullOrWhiteSpace($cosSecretKey)) { $cosSecretKey = "your_cos_secret_key" }
    } else {
        $mysqlPassword = "root123"
        $wxAppId = "your_appid_here"
        $wxSecret = "your_secret_here"
        $cosSecretId = "your_cos_secret_id"
        $cosSecretKey = "your_cos_secret_key"
    }
    
    # 写入 .env
    $envContent = @"
# ============================================================
# 社区邻里有偿互助平台 - 环境配置
# 生成时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
# ============================================================

# 微信小程序
WX_APPID=$wxAppId
WX_SECRET=$wxSecret
WX_MCH_ID=your_mch_id_here
WX_API_V3_KEY=your_v3_key_here

# 数据库
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=$mysqlPassword
MYSQL_DATABASE=neighborhood_help

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT
JWT_SECRET=$jwtSecret
JWT_REFRESH_SECRET=$jwtRefreshSecret

# 腾讯云 COS
COS_SECRET_ID=$cosSecretId
COS_SECRET_KEY=$cosSecretKey
COS_BUCKET=neighborhood-help-1250000000
COS_REGION=ap-guangzhou

# 腾讯地图
MAP_KEY=your_map_key_here

# RabbitMQ
RABBITMQ_URL=amqp://admin:admin123@localhost:5672

# Elasticsearch
ES_URL=http://localhost:9200

# MongoDB
MONGO_URL=mongodb://localhost:27017/neighborhood_help

# 前端 API 地址
VITE_API_BASE_URL=http://localhost:3000/api/v1
"@
    
    Set-Content -Path $EnvFile -Value $envContent -Encoding UTF8
    
    # 打码显示
    $maskPass = if ($mysqlPassword.Length -gt 2) { $mysqlPassword.Substring(0, 2) + "****" } else { "****" }
    $maskJwt = if ($jwtSecret.Length -gt 4) { $jwtSecret.Substring(0, 4) + "****" } else { "****" }
    
    Write-ColorOutput "  [OK] 环境变量已配置: $EnvFile" "Green"
    Write-ColorOutput "       MySQL 密码: $maskPass" "Gray"
    Write-ColorOutput "       JWT Secret: $maskJwt" "Gray"
    Write-ColorOutput "       AppID: $wxAppId" "Gray"
    
    Write-ColorOutput "  [WARN] 请将 .env 中的占位符替换为真实生产值！" "Yellow"
}

# ==================== 步骤 3: 目录初始化 ====================
function Initialize-Directories {
    Write-Step "步骤 3/9: 目录结构初始化"
    
    $dirs = @(
        "deploy\logs",
        "deploy\backups"
    )
    
    foreach ($dir in $dirs) {
        $fullPath = Join-Path $ProjectDir $dir
        if (-not (Test-Path $fullPath)) {
            New-Item -ItemType Directory -Path $fullPath -Force | Out-Null
            Initialize-Log "创建目录: $dir"
            Write-ColorOutput "  [OK] 创建: $dir" "Green"
        }
    }
    
    Initialize-Log "目录结构初始化完成"
}

# ==================== 步骤 4: Docker 镜像加速 ====================
function Setup-Mirror {
    Write-Step "步骤 4/9: Docker 镜像加速配置"
    
    $dockerConfigDir = Join-Path $env:USERPROFILE ".docker"
    $mirrorConfig = Join-Path $dockerConfigDir "daemon.json"
    
    if ((Test-Path $mirrorConfig) -and (-not $Force)) {
        Write-ColorOutput "  [SKIP] Docker 配置已存在" "Yellow"
        return
    }
    
    if (-not (Test-Path $dockerConfigDir)) {
        New-Item -ItemType Directory -Path $dockerConfigDir -Force | Out-Null
    }
    
    $mirrorConfigContent = @'
{
  "registry-mirrors": [
    "https://docker.1panel.live",
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com",
    "https://mirror.ccs.tencentyun.com"
  ],
  "max-concurrent-downloads": 3,
  "max-concurrent-uploads": 3
}
'@
    
    Set-Content -Path $mirrorConfig -Value $mirrorConfigContent -Encoding UTF8
    
    Initialize-Log "镜像配置已写入: $mirrorConfig"
    Write-ColorOutput "  [OK] 镜像加速配置已写入" "Green"
    Write-ColorOutput "  [WARN] 请重启 Docker Desktop 使配置生效！" "Yellow"
    
    if (-not $NoPrompt) {
        $reply = Read-Host "  是否现在重启 Docker Desktop？[y/N]"
        if ($reply -eq "y" -or $reply -eq "Y") {
            Write-ColorOutput "  正在重启 Docker Desktop..." "Cyan"
            try {
                Stop-Process -Name "Docker Desktop" -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 3
                $dockerPath = "${env:ProgramFiles}\Docker\Docker\Docker Desktop.exe"
                if (Test-Path $dockerPath) {
                    Start-Process $dockerPath
                    Write-ColorOutput "  [OK] Docker Desktop 启动中，等待 15 秒..." "Green"
                    Start-Sleep -Seconds 15
                } else {
                    Write-ColorOutput "  [WARN] 请手动启动 Docker Desktop" "Yellow"
                }
            } catch {
                Write-ColorOutput "  [WARN] 重启失败，请手动重启 Docker Desktop" "Yellow"
            }
        }
    }
}

# ==================== 步骤 5: 启动服务 ====================
function Start-Services {
    param([string]$ComposeCmd)
    
    Write-Step "步骤 5/9: 启动 Docker Compose 服务"
    
    Push-Location $ProjectDir
    
    # 显示服务列表
    Write-ColorOutput "  将要启动的服务:" "Cyan"
    & $ComposeCmd config --services 2>$null | ForEach-Object {
        Write-ColorOutput "    ● $_" "White"
    }
    
    # 拉取镜像
    if (-not $SkipBuild) {
        Write-ColorOutput "  拉取 Docker 镜像（首次可能需要几分钟）..." "Cyan"
        & $ComposeCmd pull 2>&1 | Tee-Object -FilePath $LogFile -Append
        Write-ColorOutput "  [OK] 镜像拉取完成" "Green"
    }
    
    # 启动服务
    Write-ColorOutput "  启动容器..." "Cyan"
    & $ComposeCmd up -d 2>&1 | Tee-Object -FilePath $LogFile -Append
    
    if ($LASTEXITCODE -ne 0) {
        Write-ColorOutput "  [FAIL] 服务启动失败！" "Red" $true
        Write-ColorOutput "  查看日志: docker compose logs" "Yellow"
        Pop-Location
        exit 1
    }
    
    # 等待 MySQL 就绪
    Write-ColorOutput "  等待 MySQL 就绪..." "Cyan"
    $maxRetries = 30
    $retry = 0
    $mysqlPassword = $null
    
    if (Test-Path $EnvFile) {
        $content = Get-Content $EnvFile -Raw
        if ($content -match 'MYSQL_PASSWORD=(.+)') {
            $mysqlPassword = $Matches[1].Trim()
        }
    }
    if (-not $mysqlPassword) { $mysqlPassword = "root123" }
    
    while ($retry -lt $maxRetries) {
        $result = docker exec nh-mysql mysqladmin ping -h localhost -u root "-p$mysqlPassword" 2>$null
        if ($result -match "alive") {
            Write-ColorOutput "  [OK] MySQL 已就绪" "Green"
            break
        }
        $retry++
        Write-ColorOutput "    等待中... ($retry/$maxRetries)" "Gray"
        Start-Sleep -Seconds 2
    }
    
    if ($retry -eq $maxRetries) {
        Write-ColorOutput "  [WARN] MySQL 启动超时" "Yellow"
    }
    
    # 显示状态
    Write-ColorOutput "`n  服务状态:" "Cyan"
    & $ComposeCmd ps
    
    Pop-Location
    
    Write-ColorOutput "  [OK] 服务启动完成" "Green"
}

# ==================== 步骤 6: 数据库初始化 ====================
function Initialize-Database {
    param([string]$ComposeCmd)
    
    Write-Step "步骤 6/9: 数据库初始化"
    
    if ($SkipMigrate) {
        Write-ColorOutput "  [SKIP] 跳过数据库迁移" "Yellow"
        return
    }
    
    $bffDir = Join-Path $ProjectDir "bff"
    
    if (-not (Test-Path $bffDir)) {
        Write-ColorOutput "  [WARN] BFF 目录不存在，跳过迁移" "Yellow"
        return
    }
    
    Push-Location $bffDir
    
    # 安装依赖
    if (-not (Test-Path "node_modules")) {
        Write-ColorOutput "  安装 BFF 依赖..." "Cyan"
        pnpm install 2>&1 | Tee-Object -FilePath $LogFile -Append
    }
    
    # Prisma 迁移
    if (Get-Command npx -ErrorAction SilentlyContinue) {
        Write-ColorOutput "  执行数据库迁移..." "Cyan"
        npx prisma migrate deploy 2>&1 | Tee-Object -FilePath $LogFile -Append
    } else {
        Write-ColorOutput "  [WARN] npx 不可用，跳过迁移" "Yellow"
    }
    
    # 创建备份用户
    $mysqlPassword = "root123"
    if (Test-Path $EnvFile) {
        $content = Get-Content $EnvFile -Raw
        if ($content -match 'MYSQL_PASSWORD=(.+)') {
            $mysqlPassword = $Matches[1].Trim()
        }
    }
    
    $createUserSql = @"
CREATE USER IF NOT EXISTS 'backup'@'%' IDENTIFIED BY 'backup_pass';
GRANT SELECT, SHOW VIEW, EVENT, TRIGGER ON neighborhood_help.* TO 'backup'@'%';
FLUSH PRIVILEGES;
"@
    
    docker exec -i nh-mysql mysql -uroot "-p$mysqlPassword" -e $createUserSql 2>$null
    Write-ColorOutput "  [OK] 备份用户已创建" "Green"
    
    # 验证
    $tableCount = docker exec nh-mysql mysql -uroot "-p$mysqlPassword" -N -e "
        SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='neighborhood_help';
    " 2>$null
    Write-ColorOutput "  业务表数量: $tableCount" "Gray"
    
    Pop-Location
}

# ==================== 步骤 7: 备份调度器配置 ====================
function Setup-BackupScheduler {
    Write-Step "步骤 7/9: 备份调度器配置"
    
    if ($SkipBackup) {
        Write-ColorOutput "  [SKIP] 跳过备份配置" "Yellow"
        return
    }
    
    $backupCompose = Join-Path $ProjectDir "docker-compose.backup.yml"
    $dockerfileBackup = Join-Path $ProjectDir "Dockerfile.backup"
    
    if (-not (Test-Path $backupCompose)) {
        Write-ColorOutput "  [WARN] 未找到 docker-compose.backup.yml" "Yellow"
        return
    }
    
    if (-not (Test-Path $dockerfileBackup)) {
        Write-ColorOutput "  [WARN] 未找到 Dockerfile.backup" "Yellow"
        return
    }
    
    # 构建备份调度器镜像
    Write-ColorOutput "  构建备份调度器镜像..." "Cyan"
    Push-Location $ProjectDir
    docker compose -f "docker-compose.backup.yml" build backup-scheduler 2>&1 | Tee-Object -FilePath $LogFile -Append
    
    # 启动备份调度器
    Write-ColorOutput "  启动备份调度器..." "Cyan"
    docker compose -f "docker-compose.yml" -f "docker-compose.backup.yml" up -d backup-scheduler 2>&1 | Tee-Object -FilePath $LogFile -Append
    Pop-Location
    
    # 等待就绪
    Write-ColorOutput "  等待备份调度器就绪..." "Cyan"
    Start-Sleep -Seconds 5
    
    # 检查状态
    $backupStatus = docker inspect --format '{{.State.Status}}' nh-backup-scheduler 2>$null
    if ($backupStatus -eq "running") {
        Write-ColorOutput "  [OK] 备份调度器已启动" "Green"
    } else {
        Write-ColorOutput "  [WARN] 备份调度器状态: $backupStatus" "Yellow"
    }
    
    # 测试首次备份
    Write-ColorOutput "  测试首次备份..." "Cyan"
    docker exec nh-backup-scheduler bash -c "source /tmp/backup-env.sh && bash /scripts/backup.sh" 2>&1 | Tee-Object -FilePath $LogFile -Append
    
    # 显示备份文件
    Write-ColorOutput "  备份文件列表:" "Cyan"
    docker exec nh-backup-scheduler ls -lh /backup/mysql/ 2>$null
    
    Write-ColorOutput "  [OK] 备份调度器配置完成" "Green"
}

# ==================== 步骤 8: 健康检查 ====================
function Health-Check {
    param([string]$ComposeCmd)
    
    Write-Step "步骤 8/9: 系统健康检查"
    
    $allHealthy = $true
    
    $mysqlPassword = "root123"
    if (Test-Path $EnvFile) {
        $content = Get-Content $EnvFile -Raw
        if ($content -match 'MYSQL_PASSWORD=(.+)') {
            $mysqlPassword = $Matches[1].Trim()
        }
    }
    
    # 容器状态
    Write-ColorOutput "  容器状态:" "Cyan"
    $containers = docker ps --format "{{.Names}}|{{.State}}" 2>$null
    foreach ($container in $containers) {
        $parts = $container -split '\|'
        $name = $parts[0]
        $state = $parts[1]
        if ($state -eq "running") {
            Write-ColorOutput "    [OK] $name - $state" "Green"
        } else {
            Write-ColorOutput "    [FAIL] $name - $state" "Red"
            $allHealthy = $false
        }
    }
    
    # MySQL
    Write-ColorOutput "`n  MySQL:" "Cyan"
    try {
        docker exec nh-mysql mysql -uroot "-p$mysqlPassword" -e "SELECT 1" 2>$null | Out-Null
        $tableCount = docker exec nh-mysql mysql -uroot "-p$mysqlPassword" -N -e "
            SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='neighborhood_help';
        " 2>$null
        Write-ColorOutput "    [OK] MySQL 连接正常，业务表: ${tableCount} 张" "Green"
    } catch {
        Write-ColorOutput "    [FAIL] MySQL 连接失败" "Red"
        $allHealthy = $false
    }
    
    # Redis
    Write-ColorOutput "`n  Redis:" "Cyan"
    $redisResult = docker exec nh-redis redis-cli ping 2>$null
    if ($redisResult -match "PONG") {
        Write-ColorOutput "    [OK] Redis 连接正常" "Green"
    } else {
        Write-ColorOutput "    [FAIL] Redis 连接失败" "Red"
        $allHealthy = $false
    }
    
    # RabbitMQ
    Write-ColorOutput "`n  RabbitMQ:" "Cyan"
    $rabbitStatus = docker exec nh-rabbitmq rabbitmqctl status 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-ColorOutput "    [OK] RabbitMQ 运行正常" "Green"
    } else {
        Write-ColorOutput "    [WARN] RabbitMQ 状态异常" "Yellow"
    }
    
    # Elasticsearch
    Write-ColorOutput "`n  Elasticsearch:" "Cyan"
    try {
        $esStatus = docker exec nh-elasticsearch curl -s http://localhost:9200/_cluster/health 2>$null
        Write-ColorOutput "    [OK] Elasticsearch 响应正常" "Green"
    } catch {
        Write-ColorOutput "    [WARN] Elasticsearch 状态未知" "Yellow"
    }
    
    # MongoDB
    Write-ColorOutput "`n  MongoDB:" "Cyan"
    try {
        $mongoPing = docker exec nh-mongodb mongosh --eval "db.runCommand({ping: 1})" 2>$null
        if ($mongoPing -match "ok") {
            Write-ColorOutput "    [OK] MongoDB 连接正常" "Green"
        } else {
            Write-ColorOutput "    [WARN] MongoDB 状态未知" "Yellow"
        }
    } catch {
        Write-ColorOutput "    [WARN] MongoDB 状态未知" "Yellow"
    }
    
    # 备份调度器
    Write-ColorOutput "`n  备份调度器:" "Cyan"
    $backupStatus = docker inspect --format '{{.State.Status}}' nh-backup-scheduler 2>$null
    if ($backupStatus -eq "running") {
        Write-ColorOutput "    [OK] 备份调度器运行正常" "Green"
        $backupCount = docker exec nh-backup-scheduler bash -c "ls /backup/mysql/full_*.sql.gz 2>/dev/null | wc -l" 2>$null
        Write-ColorOutput "    [OK] 历史备份: ${backupCount} 份" "Green"
    } else {
        Write-ColorOutput "    [WARN] 备份调度器状态: $backupStatus" "Yellow"
    }
    
    if ($allHealthy) {
        Write-ColorOutput "`n  🎉 所有服务运行正常！" "Green" $true
    } else {
        Write-ColorOutput "`n  ⚠️ 部分服务异常，请检查日志" "Yellow"
    }
}

# ==================== 步骤 9: 部署报告 ====================
function Show-DeployReport {
    param([string]$ComposeCmd)
    
    Write-Step "步骤 9/9: 部署报告"
    
    $deployTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $dockerInfo = docker version --format '{{.Server.Version}}' 2>$null
    $drive = Get-PSDrive -Name (Get-Location).Drive.Name
    $diskUsage = [math]::Round(($drive.Used / $drive.Root) * 100, 1)
    $diskFree = [math]::Round($drive.Free / 1GB, 1)
    
    $report = @"

╔══════════════════════════════════════════════════════════════════╗
║                    🎉 部署完成！                                 ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  部署时间: $deployTime
║  Docker:   $dockerInfo
║  磁盘:     ${diskFree}GB 可用 (${diskUsage}% 已用)
║                                                                  ║
║  服务端口:
║  ┌──────────────────────────────────────────────────────────┐
║  │  MySQL          :3306   root / (见 .env)                 │
║  │  Redis          :6379   (无密码)                        │
║  │  RabbitMQ       :5672   admin / admin123                │
║  │  RabbitMQ 管理  :15672  http://localhost:15672            │
║  │  Elasticsearch  :9200   (无认证)                        │
║  │  MongoDB        :27017  (无认证)                        │
║  └──────────────────────────────────────────────────────────┘
║                                                                  ║
║  常用命令:
║  ┌──────────────────────────────────────────────────────────┐
║  │  查看状态:  docker compose ps
║  │  查看日志:  docker compose logs -f
║  │  停止服务:  docker compose down
║  │  重启服务:  docker compose restart
║  │  手动备份:  docker exec nh-backup-scheduler bash -c "source /tmp/backup-env.sh && bash /scripts/backup.sh"
║  │  查看备份:  docker exec nh-backup-scheduler ls -lh /backup/mysql/
║  │  验证备份:  docker exec nh-backup-scheduler bash -c "source /tmp/backup-env.sh && bash /scripts/verify-backup.sh"
║  │  恢复备份:  docker compose -f docker-compose.backup.yml --profile executor run backup-executor bash /scripts/restore.sh /backup/mysql/full_XXX.sql.gz
║  └──────────────────────────────────────────────────────────┘
║                                                                  ║
║  下一步:
║  1. 修改 .env 中的微信/AppID/AppSecret 等生产配置
║  2. 启动 BFF 后端: cd bff && pnpm start:dev
║  3. 启动小程序前端: cd frontend && pnpm dev:mp-weixin
║  4. 生产环境配置: 参阅 deploy/BACKUP_DEPLOYMENT.md
║                                                                  ║
║  📄 详细文档: deploy/BACKUP_DEPLOYMENT.md
║  📄 备份脚本: scripts/backup.sh, scripts/restore.sh
║  📄 测试脚本: scripts/test-backup-restore.sh
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝

"@
    
    Write-ColorOutput $report "Cyan" $true
    
    # 保存报告
    $reportFile = Join-Path $ProjectDir "deploy\deploy-report-$(Get-Date -Format 'yyyyMMdd_HHmmss').txt"
    $report | Out-File -FilePath $reportFile -Encoding UTF8
    Write-ColorOutput "  部署报告: $reportFile" "Gray"
    Write-ColorOutput "  完整日志: $LogFile" "Gray"
}

# ==================== 清理 ====================
function Do-Cleanup {
    Write-Step "清理 Docker 资源"
    
    if (-not $NoPrompt) {
        Write-ColorOutput "  ⚠️ 即将停止并移除所有容器、网络和卷！" "Yellow"
        $confirm = Read-Host "  确认清理？请输入 YES"
        if ($confirm -ne "YES") {
            Write-ColorOutput "  已取消" "Gray"
            return
        }
    }
    
    Push-Location $ProjectDir
    docker compose down -v --remove-orphans 2>&1
    Pop-Location
    
    Write-ColorOutput "  [OK] 清理完成" "Green"
}

# ==================== 主入口 ====================
function Main {
    if ($Help) {
        Show-Help
        return
    }
    
    if ($Cleanup) {
        Do-Cleanup
        return
    }
    
    Write-Header
    Initialize-Log "部署日志开始: $LogFile"
    Initialize-Log "开始时间: $(Get-Date)"
    
    $interactive = -not $NoPrompt
    
    # 步骤 1: 环境检查
    $checkResult = Check-Prerequisites
    $composeCmd = $checkResult.ComposeCmd
    
    # 步骤 2: 环境变量
    Setup-Environment -Interactive $interactive
    
    # 步骤 3: 目录
    Initialize-Directories
    
    # 步骤 4: 镜像加速
    Setup-Mirror
    
    # 步骤 5: 启动服务
    Start-Services -ComposeCmd $composeCmd
    
    # 步骤 6: 数据库
    Initialize-Database -ComposeCmd $composeCmd
    
    # 步骤 7: 备份配置
    Setup-BackupScheduler
    
    # 步骤 8: 健康检查
    Health-Check -ComposeCmd $composeCmd
    
    # 步骤 9: 报告
    Show-DeployReport -ComposeCmd $composeCmd
    
    Initialize-Log "结束时间: $(Get-Date)"
    
    Write-ColorOutput "`n  🎉 部署成功！" "Green" $true
}

# 执行
Main
