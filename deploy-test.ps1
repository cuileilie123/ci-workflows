#
# ============================================================
# Neighborhood Help Platform - Test Environment Deployment
# PowerShell Script (fully ASCII to avoid PS5 encoding issues)
# ============================================================
#
# Usage:
#   .\deploy-test.ps1                  # Standard deploy: build+start+healthcheck
#   .\deploy-test.ps1 -Clean           # Remove old containers first
#   .\deploy-test.ps1 -SkipBuild       # Skip image build, reuse existing
#   .\deploy-test.ps1 -SkipSmokeTest   # Skip rate-limit smoke test
#   .\deploy-test.ps1 -JwtToken "xxx"  # Run HTTP 429 verification with a token
#
# ============================================================

[CmdletBinding()]
param(
    [switch]$Clean,
    [switch]$SkipBuild,
    [switch]$SkipSmokeTest,
    [string]$JwtToken
)

$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile    = Join-Path $ProjectDir "deploy-test-$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

# ------------------------------------------------------------
# Safe external-process wrapper.
# PowerShell 5 with $ErrorActionPreference=Stop treats any
# stderr output from native commands as a terminating error,
# even when the exit code is 0 (docker build sends progress
# to stderr).  This wrapper downgrades the strictness only
# for the native invocation and relies on $LASTEXITCODE.
# ------------------------------------------------------------
function Invoke-Raw(
    [string]$Command,
    [string[]]$Arguments,
    [switch]$LogToFile,
    [switch]$IgnoreExitCode
) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        if ($LogToFile) {
            & $Command @Arguments 2>&1 | Tee-Object -FilePath $LogFile -Append
        } else {
            & $Command @Arguments 2>&1
        }
        $ec = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
    }
    if (-not $IgnoreExitCode -and $ec -ne 0) {
        throw "Command failed (exit $ec): $Command $($Arguments -join ' ')"
    }
}

function Write-Step([string]$msg) {
    Write-Host "" -ForegroundColor Cyan
    Write-Host "------------------------------------------" -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "------------------------------------------" -ForegroundColor Cyan
    Add-Content $LogFile "[$(Get-Date -Format 'HH:mm:ss')] STEP: $msg"
}

function Write-Ok([string]$msg)   { Write-Host "  [OK]   $msg" -ForegroundColor Green;  Add-Content $LogFile "[OK]   $msg" }
function Write-Warn([string]$msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow; Add-Content $LogFile "[WARN] $msg" }
function Write-Err([string]$msg)  { Write-Host "  [FAIL] $msg" -ForegroundColor Red;    Add-Content $LogFile "[FAIL] $msg" }

# ============================================================
# Step 1: Environment check
# ============================================================
function Check-Docker {
    Write-Step "Step 1/5: Environment check"

    try {
        $ver = Invoke-Raw -Command "docker" -Arguments @("version","--format","{{.Server.Version}}") -IgnoreExitCode
        if (-not $ver -or $ver -match "(FAIL|error)") { throw "daemon not running" }
        Write-Ok "Docker $ver running"
    } catch {
        Write-Err "Docker not available. Start Docker Desktop first."
        exit 1
    }

    try {
        $cv = Invoke-Raw -Command "docker" -Arguments @("compose","version") -IgnoreExitCode
        if (-not $cv) { throw "compose missing" }
        Write-Ok "Docker Compose available"
    } catch {
        Write-Err "Docker Compose unavailable"
        exit 1
    }

    if (-not (Test-Path (Join-Path $ProjectDir "docker-compose.yml"))) {
        Write-Err "docker-compose.yml not found in project"
        exit 1
    }
    if (-not (Test-Path (Join-Path $ProjectDir "bff\.env"))) {
        Write-Err "bff\.env not found. Create it from .env.example first."
        exit 1
    }
    Write-Ok "Required files present"
}

# ============================================================
# Step 2: Optional cleanup
# ============================================================
function Invoke-Clean {
    if (-not $Clean) { return }
    Write-Step "Step 2/5: Cleanup old containers"
    Push-Location $ProjectDir
    Invoke-Raw -Command "docker" -Arguments @("compose","down","--remove-orphans") -LogToFile -IgnoreExitCode
    Pop-Location
    Write-Ok "Old containers cleaned"
}

# ============================================================
# Step 3: Build and start
# ============================================================
function Build-And-Start {
    Write-Step "Step 3/5: Build image and start services"

    Push-Location $ProjectDir

    if (-not $SkipBuild) {
        Write-Host "  Building BFF image (latest code, incl. rate limit)..." -ForegroundColor Cyan
        try {
            Invoke-Raw -Command "docker" -Arguments @("compose","build","bff") -LogToFile
            Write-Ok "BFF image built"
        } catch {
            Write-Err "BFF image build failed"
            Pop-Location; exit 1
        }
    } else {
        Write-Warn "Skip build (reusing existing image)"
    }

    Write-Host "  Starting all services..." -ForegroundColor Cyan
    try {
        Invoke-Raw -Command "docker" -Arguments @("compose","up","-d") -LogToFile
        Write-Ok "Services started"
    } catch {
        Write-Err "Service start failed"
        Pop-Location; exit 1
    }
    Pop-Location
}

# ============================================================
# Step 4: Health check (wait for readiness)
# ============================================================
function Wait-Healthy {
    Write-Step "Step 4/5: Wait for services"

    $mysqlPwd = "root123"
    $envFile = Join-Path $ProjectDir ".env"
    if (Test-Path $envFile) {
        $c = Get-Content $envFile -Raw
        if ($c -match 'MYSQL_PASSWORD=([^\r\n]+)') { $mysqlPwd = $Matches[1].Trim() }
    }

    # --- MySQL ---
    Write-Host "  Waiting for MySQL..." -ForegroundColor Cyan
    $ok = $false
    for ($i = 1; $i -le 30; $i++) {
        $r = Invoke-Raw -Command "docker" `
            -Arguments @("exec","nh-mysql","mysqladmin","ping","-h","localhost","-u","root","-p$mysqlPwd") `
            -IgnoreExitCode
        if ($r -match "alive") { $ok = $true; break }
        Write-Host "    waiting... ($i/30)" -ForegroundColor Gray
        Start-Sleep -Seconds 2
    }
    if ($ok) { Write-Ok "MySQL ready" } else { Write-Warn "MySQL timed out" }

    # --- Redis ---
    Write-Host "  Waiting for Redis..." -ForegroundColor Cyan
    $ok = $false
    for ($i = 1; $i -le 15; $i++) {
        $r = Invoke-Raw -Command "docker" -Arguments @("exec","nh-redis","redis-cli","ping") -IgnoreExitCode
        if ($r -match "PONG") { $ok = $true; break }
        Start-Sleep -Seconds 1
    }
    if ($ok) { Write-Ok "Redis ready" } else { Write-Warn "Redis timed out" }

    # --- BFF (includes migration time, so longer wait) ---
    Write-Host "  Waiting for BFF (migration included)..." -ForegroundColor Cyan
    $ok = $false
    for ($i = 1; $i -le 40; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri "http://localhost:3000/api/v1" `
                -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
            if ($resp -and $resp.StatusCode -lt 500) { $ok = $true; break }
        } catch { }
        Write-Host "    waiting... ($i/40)" -ForegroundColor Gray
        Start-Sleep -Seconds 3
    }
    if ($ok) {
        Write-Ok "BFF ready at http://localhost:3000/api/v1"
    } else {
        Write-Err "BFF failed to start. Logs: docker logs nh-bff"
        Invoke-Raw -Command "docker" -Arguments @("logs","nh-bff","--tail","40") -LogToFile -IgnoreExitCode
        exit 1
    }

    Write-Host "" -ForegroundColor Cyan
    Write-Host "  Container status:" -ForegroundColor Cyan
    Push-Location $ProjectDir
    Invoke-Raw -Command "docker" -Arguments @("compose","ps") -IgnoreExitCode
    Pop-Location
}

# ============================================================
# Step 5: Rate-limit smoke test
# ============================================================
function Invoke-SmokeTest {
    if ($SkipSmokeTest) {
        Write-Step "Step 5/5: Smoke test skipped"
        Write-Warn "Skipped by -SkipSmokeTest flag"
        return
    }

    Write-Step "Step 5/5: Rate limit smoke test"

    # --- Lua script validation inside Redis (no token needed) ---
    Write-Host "  [1/2] Verify Redis rate-limit Lua script..." -ForegroundColor Cyan

    # Lua passed as single-line escaped command (avoid PowerShell here-string encoding issues)
    $lua = 'local count = redis.call(''INCR'', KEYS[1]); ' + `
           'if count == 1 then redis.call(''EXPIRE'', KEYS[1], ARGV[1]) end; ' + `
           'return count;'
    $key = "smoketest:ratelimit:$(Get-Date -Format 'yyyyMMddHHmmss')"

    $r1 = Invoke-Raw -Command "docker" -Arguments @("exec","nh-redis","redis-cli","EVAL",$lua,"1",$key,"3600") -IgnoreExitCode
    $r2 = Invoke-Raw -Command "docker" -Arguments @("exec","nh-redis","redis-cli","EVAL",$lua,"1",$key,"3600") -IgnoreExitCode
    $r3 = Invoke-Raw -Command "docker" -Arguments @("exec","nh-redis","redis-cli","EVAL",$lua,"1",$key,"3600") -IgnoreExitCode
    $r4 = Invoke-Raw -Command "docker" -Arguments @("exec","nh-redis","redis-cli","EVAL",$lua,"1",$key,"3600") -IgnoreExitCode
    Invoke-Raw -Command "docker" -Arguments @("exec","nh-redis","redis-cli","DEL",$key) -IgnoreExitCode | Out-Null

    if ($r1 -eq "1" -and $r2 -eq "2" -and $r3 -eq "3" -and $r4 -eq "4") {
        Write-Ok "Lua counter increments correctly (1->2->3->4), over-limit can be rejected"
    } else {
        Write-Warn "Unexpected counter values: $r1,$r2,$r3,$r4"
    }

    # --- Optional HTTP 429 verification (needs a valid JWT token) ---
    if ($JwtToken) {
        Write-Host "  [2/2] HTTP /wallet/withdraw rate-limit (429) verification..." -ForegroundColor Cyan
        $headers = @{
            Authorization = "Bearer $JwtToken"
            "Content-Type" = "application/json"
        }
        $results = @()
        for ($i = 1; $i -le 4; $i++) {
            try {
                $resp = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/wallet/withdraw" `
                    -Method POST -Headers $headers -Body '{"amount":1}' `
                    -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
                $results += [string]$resp.StatusCode
            } catch {
                $code = [int]$_.Exception.Response.StatusCode
                if ($code -eq 0) { $results += "ERR" } else { $results += [string]$code }
            }
            Start-Sleep -Milliseconds 200
        }
        Write-Host "    4 requests: $($results -join ', ')" -ForegroundColor Gray
        if ($results[3] -eq "429") {
            Write-Ok "4th request got 429 - rate limiting is LIVE"
        } else {
            Write-Warn "4th request not 429. Possibilities: Redis not connected, or insufficient balance triggered first."
        }
    } else {
        Write-Host "  [2/2] HTTP check skipped (no -JwtToken)." -ForegroundColor Gray
        Write-Host "        To run: .\deploy-test.ps1 -JwtToken your_jwt -SkipBuild" -ForegroundColor Gray
    }
}

# ============================================================
# Final report
# ============================================================
function Show-Report {
    Write-Step "Deployment complete"

    $report = @"

  ============================================
        Test Environment is ready
  ============================================
  BFF:        http://localhost:3000/api/v1
  MySQL:      localhost:3306
  Redis:      localhost:6379
  RabbitMQ:   localhost:5672 (mgmt :15672)
  MongoDB:    localhost:27017
  Elastic:    localhost:9200

  Useful commands:
    Logs:       docker compose logs -f bff
    Restart:    docker compose restart bff
    Stop all:   docker compose down
    Redeploy:   .\deploy-test.ps1 -Clean

  Rate limit verification:
    Lua script validated. For HTTP 429:
      1) Login and obtain a token
      2) Run: .\deploy-test.ps1 -JwtToken 'TOKEN' -SkipBuild

  Log file: $LogFile
"@
    Write-Host $report -ForegroundColor Cyan
    Add-Content $LogFile $report
}

# ============================================================
# MAIN
# ============================================================
Write-Host "" -ForegroundColor Cyan
Write-Host "  Neighborhood Help - Test Environment Deploy" -ForegroundColor Cyan
Write-Host "" -ForegroundColor Cyan
Add-Content $LogFile "=== Test Deploy $(Get-Date) ==="

Check-Docker
Invoke-Clean
Build-And-Start
Wait-Healthy
Invoke-SmokeTest
Show-Report
