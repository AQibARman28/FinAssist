# Starts FinAssist locally: MongoDB + Express API + Next.js frontend.
#
#   powershell -ExecutionPolicy Bypass -File .\start-local.ps1
#
# Then open http://localhost:3000
#
# Each service opens in its own window so you can read its log; close a window
# to stop that service. The database lives in %USERPROFILE%\finassist-local-db
# and persists between runs.

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$dbRoot = Join-Path $env:USERPROFILE 'finassist-local-db'
$mongod = Join-Path $dbRoot 'bin\mongod.exe'
$dbpath = Join-Path $dbRoot 'data'

function Test-Port($port) {
    try {
        $client = New-Object Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', $port)
        $client.Close()
        return $true
    } catch { return $false }
}

# ── MongoDB ──────────────────────────────────────────────────────────────────
if (Test-Port 27017) {
    Write-Host "MongoDB already listening on 27017" -ForegroundColor DarkGray
} elseif (Test-Path $mongod) {
    New-Item -ItemType Directory -Force -Path $dbpath | Out-Null
    Start-Process -FilePath $mongod `
        -ArgumentList "--dbpath `"$dbpath`" --port 27017 --bind_ip 127.0.0.1" `
        -WindowStyle Minimized
    Write-Host "MongoDB starting on 27017 (data: $dbpath)" -ForegroundColor Green
} else {
    Write-Host "mongod not found at $mongod" -ForegroundColor Red
    Write-Host "Either restore it, or point Backend\.env MONGO_URI at a MongoDB Atlas cluster." -ForegroundColor Yellow
    exit 1
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
