# Starts FinAssist locally: MongoDB + Express API + Next.js frontend.
#
#   powershell -ExecutionPolicy Bypass -File .\start-local.ps1
#
# Then open http://localhost:3000. See RUNNING-LOCALLY.md for the first-time setup
# (Node 22, MongoDB 8, Backend\.env).
#
# Each service opens in its own window so you can read its log; close a window
# to stop that service. MongoDB data lives in %USERPROFILE%\finassist-local-db
# and persists between runs.

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$dbRoot = Join-Path $env:USERPROFILE 'finassist-local-db'
$dbpath = Join-Path $dbRoot 'data'

function Test-Port($port) {
    try {
        $client = New-Object Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', $port)
        $client.Close()
        return $true
    } catch { return $false }
}

# The mongod to start: $env:MONGOD_PATH, then a copy in finassist-local-db, then PATH.
function Find-Mongod {
    if ($env:MONGOD_PATH -and (Test-Path $env:MONGOD_PATH)) { return $env:MONGOD_PATH }
    $local = Join-Path $dbRoot 'bin\mongod.exe'
    if (Test-Path $local) { return $local }
    $onPath = Get-Command mongod -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    return $null
}

# ── First-run checks ─────────────────────────────────────────────────────────
if (-not (Test-Path (Join-Path $root 'Backend\.env'))) {
    Write-Host "Backend\.env not found." -ForegroundColor Red
    Write-Host "Copy Backend\.env.example to Backend\.env and fill in the three secrets (RUNNING-LOCALLY.md, step 2)." -ForegroundColor Yellow
    exit 1
}
foreach ($app in 'Backend', 'views') {
    if (-not (Test-Path (Join-Path $root "$app\node_modules"))) {
        Write-Host "Installing packages in $app (first run)..." -ForegroundColor Green
        Push-Location (Join-Path $root $app)
        try { npm install } finally { Pop-Location }
    }
}

# ── MongoDB ──────────────────────────────────────────────────────────────────
if (Test-Port 27017) {
    Write-Host "MongoDB already listening on 27017" -ForegroundColor DarkGray
} else {
    $mongod = Find-Mongod
    if (-not $mongod) {
        Write-Host "No MongoDB on 27017 and no mongod found." -ForegroundColor Red
        Write-Host "Install MongoDB 8 Community Server, or run: docker run -d --name finassist-mongo -p 27017:27017 mongo:8" -ForegroundColor Yellow
        Write-Host "(or set MONGOD_PATH to a mongod.exe, or point Backend\.env MONGO_URI at MongoDB Atlas)" -ForegroundColor Yellow
        exit 1
    }
    New-Item -ItemType Directory -Force -Path $dbpath | Out-Null
    Start-Process -FilePath $mongod `
        -ArgumentList "--dbpath `"$dbpath`" --port 27017 --bind_ip 127.0.0.1" `
        -WindowStyle Minimized
    Write-Host "MongoDB starting on 27017 (data: $dbpath)" -ForegroundColor Green
}

# ── Backend API (port 5000) ──────────────────────────────────────────────────
if (Test-Port 5000) {
    Write-Host "Something is already listening on 5000 - skipping backend" -ForegroundColor DarkGray
} else {
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/k npm run dev' -WorkingDirectory (Join-Path $root 'Backend')
    Write-Host "Backend starting on http://localhost:5000" -ForegroundColor Green
}

# ── Frontend (port 3000) ─────────────────────────────────────────────────────
if (Test-Port 3000) {
    Write-Host "Something is already listening on 3000 - skipping frontend" -ForegroundColor DarkGray
} else {
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/k npm run dev' -WorkingDirectory (Join-Path $root 'views')
    Write-Host "Frontend starting on http://localhost:3000" -ForegroundColor Green
}

Write-Host ""
Write-Host "Open http://localhost:3000 once the frontend window says 'Ready'." -ForegroundColor Cyan
Write-Host "Health check: http://localhost:5000/api/health" -ForegroundColor Cyan
