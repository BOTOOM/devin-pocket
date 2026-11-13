param(
    [ValidatePattern('^(latest|[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)$')]
    [string]$Version = 'latest',
    [switch]$InstallDevin
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js is missing. Install Node.js 26 LTS with: winget install OpenJS.NodeJS.LTS --version 26.13.1. Then reopen PowerShell.'
}
$nodeVersion = & node.exe --version
$nodeExit = $LASTEXITCODE
$nodeMajor = 0
if ($nodeVersion -match '^v([0-9]+)\.') { $nodeMajor = [int]$Matches[1] }
if ($nodeExit -ne 0 -or $nodeMajor -eq 0) {
    throw 'Could not determine the Node.js version. Repair the installation, reopen PowerShell and retry.'
}
if ($nodeMajor -lt 24) {
    throw 'Upgrade Node.js <24 to Node.js 24 LTS with: winget install OpenJS.NodeJS.LTS --version 24.22.1. Then reopen PowerShell. Existing Node.js 24+ is left unchanged; the app runtime minimum remains 22.'
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
