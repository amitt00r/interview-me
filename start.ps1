# Starts the backend, waits until it answers, then runs the frontend dev server (Windows).
# Ctrl+C stops both. Backend output goes to logs\backend.log.
#
#   .\start.ps1        (or double-click / run start.cmd)
#
# Set ANTHROPIC_API_KEY first, or OPENAI_API_KEY with app.ai.provider: openai (and optionally AZURE_SPEECH_KEY / AZURE_SPEECH_REGION for voice), e.g.
#   $env:ANTHROPIC_API_KEY = "sk-ant-..."
$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
$BackendUrl = 'http://localhost:8080/api/companies'
$WaitSeconds = 180
$LogDir = Join-Path $Root 'logs'
$Log = Join-Path $LogDir 'backend.log'
$ErrLog = Join-Path $LogDir 'backend.err.log'

function Test-Backend {
    try {
        Invoke-WebRequest -Uri $BackendUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        # Any HTTP response (even an error status) means the server is up.
        return $null -ne $_.Exception.Response
    }
}

foreach ($cmd in 'java', 'mvn', 'npm') {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Error "'$cmd' is not installed or not on PATH."
    }
}
if (-not $env:ANTHROPIC_API_KEY -and -not $env:OPENAI_API_KEY) {
    Write-Warning "Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set; the backend will not start without the selected provider's key."
}
if (Test-Backend) {
    Write-Error 'Something is already running on port 8080. Stop it first.'
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$backend = $null
try {
    Write-Host 'Starting backend (log: logs\backend.log)...'
    # mvn is a .cmd script on Windows, so run it through cmd.exe.
    $backend = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'mvn -q spring-boot:run' `
        -WorkingDirectory (Join-Path $Root 'backend') -NoNewWindow -PassThru `
        -RedirectStandardOutput $Log -RedirectStandardError $ErrLog

    Write-Host -NoNewline 'Waiting for backend on http://localhost:8080 '
    $ready = $false
    for ($i = 0; $i -lt $WaitSeconds; $i++) {
        if (Test-Backend) { $ready = $true; break }
        if ($backend.HasExited) {
            Write-Host ''
            Write-Host 'The backend stopped while starting. Last lines of logs\backend.log:' -ForegroundColor Red
            Get-Content $Log -Tail 30 -ErrorAction SilentlyContinue
            Get-Content $ErrLog -Tail 30 -ErrorAction SilentlyContinue
            exit 1
        }
        Write-Host -NoNewline '.'
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        Write-Host ''
        Write-Host "The backend did not start within $WaitSeconds s. See logs\backend.log." -ForegroundColor Red
        exit 1
    }
    Write-Host ' ready.'

    Set-Location (Join-Path $Root 'frontend')
    if (-not (Test-Path 'node_modules')) {
        Write-Host 'Installing frontend dependencies...'
        & npm install
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    Write-Host 'Starting frontend; open the Local URL Vite prints below (normally http://localhost:5173). Ctrl+C stops both.'
    & npm run dev
} finally {
    # Runs on normal exit and on Ctrl+C. /T also stops the JVM that Maven forks.
    if ($backend -and -not $backend.HasExited) {
        Write-Host ''
        Write-Host 'Stopping backend...'
        & taskkill.exe /PID $backend.Id /T /F | Out-Null
    }
    Set-Location $Root
}
