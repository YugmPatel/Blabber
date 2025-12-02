# ============================================
# WhatsApp Chat - Master Startup Script
# ============================================
# Usage:
#   .\start.ps1              - Start all services (interactive)
#   .\start.ps1 -Quick       - Start all services without prompts
#   .\start.ps1 -ServicesOnly - Start only backend services (no frontend)
#   .\start.ps1 -Stop        - Stop all services
#   .\start.ps1 -Status      - Check status of all services
# ============================================

param(
    [switch]$Quick,
    [switch]$ServicesOnly,
    [switch]$Stop,
    [switch]$Status,
    [switch]$Help
)

# Service Configuration
$Services = @(
    @{ Name = "Auth";     Port = 3001; Path = "services\auth" }
    @{ Name = "Users";    Port = 3002; Path = "services\users" }
    @{ Name = "Chats";    Port = 3003; Path = "services\chats" }
    @{ Name = "Messages"; Port = 3004; Path = "services\messages" }
    @{ Name = "Media";    Port = 3005; Path = "services\media" }
    @{ Name = "Gateway";  Port = 3000; Path = "apps\gateway" }
)

$Frontend = @{ Name = "Frontend"; Port = 5173; Path = "apps\web" }

function Show-Banner {
    Write-Host ""
    Write-Host "  ========================================================" -ForegroundColor Cyan
    Write-Host "       WhatsApp Chat - Microservices Startup Script       " -ForegroundColor Green
    Write-Host "  ========================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Show-Help {
    Show-Banner
    Write-Host "  Usage:" -ForegroundColor Yellow
    Write-Host "    .\start.ps1              - Start all services (interactive)" -ForegroundColor White
    Write-Host "    .\start.ps1 -Quick       - Start all services without prompts" -ForegroundColor White
    Write-Host "    .\start.ps1 -ServicesOnly - Start only backend services" -ForegroundColor White
    Write-Host "    .\start.ps1 -Stop        - Stop all services" -ForegroundColor White
    Write-Host "    .\start.ps1 -Status      - Check status of all services" -ForegroundColor White
    Write-Host "    .\start.ps1 -Help        - Show this help message" -ForegroundColor White
    Write-Host ""
    Write-Host "  Services:" -ForegroundColor Yellow
    foreach ($svc in $Services) {
        Write-Host "    $($svc.Name.PadRight(12)) - Port $($svc.Port)" -ForegroundColor White
    }
    Write-Host "    $($Frontend.Name.PadRight(12)) - Port $($Frontend.Port)" -ForegroundColor White
    Write-Host ""
}

function Test-Docker {
    Write-Host "  Checking Docker..." -ForegroundColor Yellow
    try {
        $null = docker ps 2>&1
        Write-Host "  [OK] Docker is running" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "  [ERROR] Docker is not running!" -ForegroundColor Red
        Write-Host "  Please start Docker Desktop first." -ForegroundColor Yellow
        return $false
    }
}

function Test-Port {
    param([int]$Port)
    try {
        $connection = New-Object System.Net.Sockets.TcpClient
        $connection.Connect("localhost", $Port)
        $connection.Close()
        return $true
    } catch {
        return $false
    }
}

function Start-Databases {
    Write-Host ""
    Write-Host "  Starting Databases..." -ForegroundColor Yellow
    
    docker-compose -f docker-compose.dev.yml up mongodb redis -d 2>&1 | Out-Null
    
    Write-Host "  Waiting for databases to be ready..." -ForegroundColor Yellow
    $maxAttempts = 30
    $attempt = 0
    
    while ($attempt -lt $maxAttempts) {
        $mongoReady = docker ps --filter "name=whatsapp-chat-mongodb" --filter "status=running" -q
        $redisReady = docker ps --filter "name=whatsapp-chat-redis" --filter "status=running" -q
        
        if ($mongoReady -and $redisReady) {
            Write-Host "  [OK] MongoDB is running (port 27017)" -ForegroundColor Green
            Write-Host "  [OK] Redis is running (port 6379)" -ForegroundColor Green
            return $true
        }
        
        Start-Sleep -Seconds 1
        $attempt++
    }
    
    Write-Host "  [ERROR] Failed to start databases" -ForegroundColor Red
    return $false
}

function Start-Service {
    param(
        [string]$Name,
        [int]$Port,
        [string]$Path
    )
    
    $fullPath = Join-Path $PSScriptRoot $Path
    
    if (-not (Test-Path $fullPath)) {
        Write-Host "  [ERROR] $Name service path not found: $Path" -ForegroundColor Red
        return $false
    }
    
    Write-Host "  Starting $Name (port $Port)..." -ForegroundColor Yellow
    
    $title = "$Name Service - Port $Port"
    Start-Process powershell -ArgumentList @(
        "-NoExit",
        "-Command",
        "`$Host.UI.RawUI.WindowTitle = '$title'; cd '$fullPath'; Write-Host '$title' -ForegroundColor Cyan; Write-Host ''; pnpm dev"
    )
    
    return $true
}

function Start-AllServices {
    param([bool]$IncludeFrontend = $true)
    
    Show-Banner
    
    if (-not (Test-Docker)) {
        return
    }
    
    if (-not (Start-Databases)) {
        return
    }
    
    Write-Host ""
    Write-Host "  Starting Microservices..." -ForegroundColor Cyan
    Write-Host ""
    
    foreach ($svc in $Services) {
        Start-Service -Name $svc.Name -Port $svc.Port -Path $svc.Path
        Start-Sleep -Seconds 2
    }
    
    if ($IncludeFrontend) {
        Start-Sleep -Seconds 2
        Start-Service -Name $Frontend.Name -Port $Frontend.Port -Path $Frontend.Path
    }
    
    Write-Host ""
    Write-Host "  ========================================================" -ForegroundColor Green
    Write-Host "              All Services Started Successfully!          " -ForegroundColor Green
    Write-Host "  ========================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Service URLs:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Databases:" -ForegroundColor Magenta
    Write-Host "    MongoDB:        mongodb://localhost:27017" -ForegroundColor White
    Write-Host "    Redis:          redis://localhost:6379" -ForegroundColor White
    Write-Host ""
    Write-Host "  Backend Services:" -ForegroundColor Magenta
    foreach ($svc in $Services) {
        Write-Host "    $($svc.Name.PadRight(14)) http://localhost:$($svc.Port)" -ForegroundColor White
    }
    
    if ($IncludeFrontend) {
        Write-Host ""
        Write-Host "  Frontend:" -ForegroundColor Magenta
        Write-Host "    $($Frontend.Name.PadRight(14)) http://localhost:$($Frontend.Port)" -ForegroundColor White
    }
    
    Write-Host ""
    Write-Host "  Open http://localhost:5173 in your browser!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Tips:" -ForegroundColor Yellow
    Write-Host "    - Watch the service windows for logs" -ForegroundColor White
    Write-Host "    - Run .\start.ps1 -Status to check service health" -ForegroundColor White
    Write-Host "    - Run .\start.ps1 -Stop to stop all services" -ForegroundColor White
    Write-Host ""
}

function Stop-AllServices {
    Show-Banner
    Write-Host "  Stopping all services..." -ForegroundColor Yellow
    Write-Host ""
    
    Write-Host "  Stopping Docker containers..." -ForegroundColor Yellow
    docker-compose -f docker-compose.dev.yml down 2>&1 | Out-Null
    Write-Host "  [OK] Docker containers stopped" -ForegroundColor Green
    
    Write-Host "  Stopping Node.js processes..." -ForegroundColor Yellow
    
    $allPorts = @(3000, 3001, 3002, 3003, 3004, 3005, 5173)
    foreach ($port in $allPorts) {
        try {
            $process = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | 
                       Select-Object -ExpandProperty OwningProcess -ErrorAction SilentlyContinue
            if ($process) {
                Stop-Process -Id $process -Force -ErrorAction SilentlyContinue
            }
        } catch {}
    }
    
    Write-Host "  [OK] All services stopped" -ForegroundColor Green
    Write-Host ""
}

function Show-Status {
    Show-Banner
    Write-Host "  Service Status:" -ForegroundColor Cyan
    Write-Host ""
    
    Write-Host "  Databases:" -ForegroundColor Magenta
    
    $mongoRunning = docker ps --filter "name=whatsapp-chat-mongodb" --filter "status=running" -q 2>$null
    if ($mongoRunning) {
        Write-Host "    [OK] MongoDB (27017)     - Running" -ForegroundColor Green
    } else {
        Write-Host "    [--] MongoDB (27017)     - Stopped" -ForegroundColor Red
    }
    
    $redisRunning = docker ps --filter "name=whatsapp-chat-redis" --filter "status=running" -q 2>$null
    if ($redisRunning) {
        Write-Host "    [OK] Redis (6379)        - Running" -ForegroundColor Green
    } else {
        Write-Host "    [--] Redis (6379)        - Stopped" -ForegroundColor Red
    }
    
    Write-Host ""
    Write-Host "  Backend Services:" -ForegroundColor Magenta
    
    foreach ($svc in $Services) {
        if (Test-Port -Port $svc.Port) {
            Write-Host "    [OK] $($svc.Name.PadRight(12)) ($($svc.Port))  - Running" -ForegroundColor Green
        } else {
            Write-Host "    [--] $($svc.Name.PadRight(12)) ($($svc.Port))  - Stopped" -ForegroundColor Red
        }
    }
    
    Write-Host ""
    Write-Host "  Frontend:" -ForegroundColor Magenta
    
    if (Test-Port -Port $Frontend.Port) {
        Write-Host "    [OK] $($Frontend.Name.PadRight(12)) ($($Frontend.Port)) - Running" -ForegroundColor Green
    } else {
        Write-Host "    [--] $($Frontend.Name.PadRight(12)) ($($Frontend.Port)) - Stopped" -ForegroundColor Red
    }
    
    Write-Host ""
}

# ============================================
# Main Script Execution
# ============================================

if ($Help) {
    Show-Help
    exit 0
}

if ($Stop) {
    Stop-AllServices
    exit 0
}

if ($Status) {
    Show-Status
    exit 0
}

if ($Quick) {
    Start-AllServices -IncludeFrontend (-not $ServicesOnly)
    exit 0
}

if ($ServicesOnly) {
    Start-AllServices -IncludeFrontend $false
    exit 0
}

# Interactive mode
Show-Banner

Write-Host "  What would you like to do?" -ForegroundColor Cyan
Write-Host ""
Write-Host "    [1] Start all services (recommended)" -ForegroundColor White
Write-Host "    [2] Start backend only (no frontend)" -ForegroundColor White
Write-Host "    [3] Check service status" -ForegroundColor White
Write-Host "    [4] Stop all services" -ForegroundColor White
Write-Host "    [5] Exit" -ForegroundColor White
Write-Host ""

$choice = Read-Host "  Enter your choice (1-5)"

switch ($choice) {
    "1" { Start-AllServices -IncludeFrontend $true }
    "2" { Start-AllServices -IncludeFrontend $false }
    "3" { Show-Status }
    "4" { Stop-AllServices }
    "5" { Write-Host "  Goodbye!" -ForegroundColor Green }
    default { 
        Write-Host "  Invalid choice. Starting all services..." -ForegroundColor Yellow
        Start-AllServices -IncludeFrontend $true
    }
}
