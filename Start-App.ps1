$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Install Node.js 24 or newer from nodejs.org, then reopen this app.' }
if (-not (Test-Path -LiteralPath 'node_modules')) { throw 'First-time setup required: run pnpm install --frozen-lockfile in this folder. See README.md.' }
$appPort = if ($env:APP_PORT) { [int]$env:APP_PORT } else { 8788 }
$appUrl = "http://127.0.0.1:$appPort/"
$ready = $false
try { $page = Invoke-WebRequest -UseBasicParsing -Uri $appUrl -TimeoutSec 2; $ready = $page.Content.Contains('name="dashboard-token"') } catch { }
if (-not $ready) {
 New-Item -ItemType Directory -Path 'data' -Force | Out-Null
 Start-Process -FilePath $nodePath -ArgumentList 'dist/app.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput 'data/app.log' -RedirectStandardError 'data/app-error.log'
 for ($i=0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  try { $page = Invoke-WebRequest -UseBasicParsing -Uri $appUrl -TimeoutSec 1; if ($page.Content.Contains('name="dashboard-token"')) { $ready=$true; break } } catch { }
 }
}
if (-not $ready) { throw 'App could not start. Check data/app-error.log. Port 8788 may already be in use.' }
$edgePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
if (Test-Path -LiteralPath $edgePath) { Start-Process -FilePath $edgePath -ArgumentList "--app=$appUrl" } else { Start-Process $appUrl }
