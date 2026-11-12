param(
    [ValidatePattern('^(latest|[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)$')]
    [string]$Version = 'latest',
    [switch]$InstallDevin
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js 22+ is required. Install it with: winget install OpenJS.NodeJS.LTS. Then reopen PowerShell.'
}
$nodeVersion = & node.exe --version
$nodeExit = $LASTEXITCODE
$nodeMajor = 0
if ($nodeVersion -match '^v([0-9]+)\.') { $nodeMajor = [int]$Matches[1] }
if ($nodeExit -ne 0 -or $nodeMajor -lt 22) {
    throw 'Node.js 22+ is required. Upgrade with: winget install OpenJS.NodeJS.LTS. Then reopen PowerShell.'
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'npm is required. Reinstall Node.js LTS, then reopen PowerShell.'
}

if (-not (Get-Command devin.exe -ErrorAction SilentlyContinue)) {
    Write-Host 'Install Devin CLI from PowerShell: irm https://static.devin.ai/cli/setup.ps1 | iex'
    if (-not $InstallDevin) {
        throw 'Devin CLI was not found on PATH. Install it, reopen PowerShell and retry; or download this script and run it with -InstallDevin.'
    }
    Invoke-Expression (Invoke-RestMethod 'https://static.devin.ai/cli/setup.ps1')
    if (-not (Get-Command devin.exe -ErrorAction SilentlyContinue)) {
        throw 'Devin CLI is not yet on PATH. Reopen PowerShell and run this installer again.'
    }
}

& npm.cmd install -g "devin-pocket@$Version"
if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)." }

Write-Host 'Devin Pocket installed (experimental native Windows support).'
Write-Host 'In PowerShell / Windows Terminal, run: devin-pocket start'
Write-Host 'If PowerShell blocks the npm shim, use: devin-pocket.cmd start'
Write-Host 'Open http://127.0.0.1:7777 and sign in to Devin in the browser.'
Write-Host 'Diagnostics: devin-pocket doctor. Logs: devin-pocket logs. Stop: devin-pocket stop.'
Write-Host 'Keep the default loopback binding: Pocket has no built-in client authentication or TLS.'
