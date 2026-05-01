param(
  [string]$ProjectRoot = (Resolve-Path ".").Path,
  [string]$PagesUrl = "https://feishu-ai-im-collab-assistant.pages.dev",
  [string]$ApiUrl = "http://localhost:8787"
)

$ErrorActionPreference = "Stop"

$runtimeDir = Join-Path $ProjectRoot ".runtime"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

function Test-HttpOk([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Start-NpmBackground([string[]]$NpmArgs, [string]$Name) {
  $out = Join-Path $ProjectRoot ".runtime\$Name.out.log"
  $err = Join-Path $ProjectRoot ".runtime\$Name.err.log"
  Start-Process -FilePath "npm.cmd" -ArgumentList $NpmArgs -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
  return @{ stdout = $out; stderr = $err }
}

function Resolve-CloudflaredPath {
  $command = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($command?.Source) {
    return $command.Source
  }

  $wingetInstall = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter cloudflared.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName

  if ($wingetInstall) {
    return $wingetInstall
  }

  throw "cloudflared is not installed. Run: winget install --id Cloudflare.cloudflared -e"
}

Write-Host "== Agent API =="
if (-not (Test-HttpOk "$ApiUrl/health")) {
  Write-Host "Starting API..."
  Start-NpmBackground -NpmArgs @("run", "dev:api") -Name "api" | Out-Null
  Start-Sleep -Seconds 8
}

if (-not (Test-HttpOk "$ApiUrl/health")) {
  throw "API did not become healthy at $ApiUrl/health"
}
Write-Host "API healthy: $ApiUrl"

Write-Host ""
Write-Host "== Lark event bridge =="
Start-NpmBackground -NpmArgs @("run", "dev:lark-events") -Name "lark-events" | Out-Null
Write-Host "Lark event bridge started. Logs: .runtime/lark-events.err.log"

Write-Host ""
Write-Host "== Cloudflare Tunnel =="
$cloudflaredPath = Resolve-CloudflaredPath
$tunnelOut = Join-Path $runtimeDir "cloudflared.out.log"
$tunnelErr = Join-Path $runtimeDir "cloudflared.err.log"
Remove-Item -LiteralPath $tunnelOut, $tunnelErr -ErrorAction SilentlyContinue

$cloudflared = Start-Process -FilePath $cloudflaredPath -ArgumentList @("tunnel", "--url", $ApiUrl, "--no-autoupdate") -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr -PassThru

$deadline = (Get-Date).AddSeconds(45)
$publicApiUrl = $null
while ((Get-Date) -lt $deadline -and -not $publicApiUrl) {
  Start-Sleep -Seconds 2
  $logText = ((Get-Content $tunnelOut -ErrorAction SilentlyContinue) + (Get-Content $tunnelErr -ErrorAction SilentlyContinue)) -join "`n"
  $match = [regex]::Match($logText, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
  if ($match.Success) {
    $publicApiUrl = $match.Value
  }
  if ($cloudflared.HasExited) {
    break
  }
}

if (-not $publicApiUrl) {
  throw "Cloudflare Tunnel did not produce a URL. Check $tunnelErr"
}

$dashboardUrl = "$PagesUrl/?api=$publicApiUrl"
$state = [ordered]@{
  generatedAt = (Get-Date).ToString("o")
  apiLocalUrl = $ApiUrl
  apiPublicUrl = $publicApiUrl
  dashboardUrl = $dashboardUrl
  cloudflaredPid = $cloudflared.Id
}
$statePath = Join-Path $runtimeDir "demo-stack.json"
$state | ConvertTo-Json | Set-Content -Path $statePath -Encoding UTF8

Write-Host "Public API: $publicApiUrl"
Write-Host "Dashboard: $dashboardUrl"
Write-Host "State: $statePath"
