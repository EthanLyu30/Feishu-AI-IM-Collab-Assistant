param(
  [string]$ProjectRoot = (Resolve-Path ".").Path,
  [string]$PagesUrl = "",
  [string]$ApiUrl = "http://localhost:8787",
  [string]$PublicApiUrl = "",
  [string]$TunnelName = "",
  [string]$TunnelToken = ""
)

$ErrorActionPreference = "Stop"

function Import-DotEnv([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    $separator = $trimmed.IndexOf("=")
    if ($separator -lt 1) {
      continue
    }

    $key = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim().Trim('"').Trim("'")
    if (-not [Environment]::GetEnvironmentVariable($key, "Process")) {
      Set-Item -Path "Env:$key" -Value $value
    }
  }
}

function Test-HttpOk([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 12
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

Import-DotEnv (Join-Path $ProjectRoot ".env")
Import-DotEnv (Join-Path $ProjectRoot ".env.local")

if (-not $PagesUrl) {
  $PagesUrl = if ($env:PUBLIC_WEB_BASE_URL) { $env:PUBLIC_WEB_BASE_URL } else { "https://feishu-ai-im-collab-assistant.pages.dev" }
}
if (-not $PublicApiUrl -and $env:PUBLIC_API_BASE_URL) {
  $PublicApiUrl = $env:PUBLIC_API_BASE_URL
}
if (-not $TunnelName -and $env:CLOUDFLARE_TUNNEL_NAME) {
  $TunnelName = $env:CLOUDFLARE_TUNNEL_NAME
}
if (-not $TunnelToken -and $env:CLOUDFLARE_TUNNEL_TOKEN) {
  $TunnelToken = $env:CLOUDFLARE_TUNNEL_TOKEN
}

if (-not $PublicApiUrl) {
  throw "Set PUBLIC_API_BASE_URL or pass -PublicApiUrl, for example https://api.your-domain.com"
}
if (-not $TunnelName -and -not $TunnelToken) {
  throw "Set CLOUDFLARE_TUNNEL_NAME or CLOUDFLARE_TUNNEL_TOKEN before starting the stable stack."
}

$runtimeDir = Join-Path $ProjectRoot ".runtime"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

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
Write-Host "== Cloudflare Named Tunnel =="
$cloudflaredPath = Resolve-CloudflaredPath
$tunnelOut = Join-Path $runtimeDir "cloudflared-stable.out.log"
$tunnelErr = Join-Path $runtimeDir "cloudflared-stable.err.log"
Remove-Item -LiteralPath $tunnelOut, $tunnelErr -ErrorAction SilentlyContinue

$tunnelMode = "named"
if ($TunnelToken) {
  $tunnelMode = "token"
  $tokenFile = Join-Path $runtimeDir "cloudflare-tunnel-token.txt"
  Set-Content -LiteralPath $tokenFile -Value $TunnelToken -NoNewline -Encoding ASCII
  $arguments = @("tunnel", "--no-autoupdate", "run", "--token-file", $tokenFile)
} else {
  $arguments = @("tunnel", "--no-autoupdate", "run", $TunnelName)
}

$cloudflared = Start-Process -FilePath $cloudflaredPath -ArgumentList $arguments -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr -PassThru

$deadline = (Get-Date).AddSeconds(75)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  if (Test-HttpOk "$PublicApiUrl/health") {
    break
  }
  if ($cloudflared.HasExited) {
    throw "Cloudflare Named Tunnel exited early. Check $tunnelErr"
  }
}

if (-not (Test-HttpOk "$PublicApiUrl/health")) {
  throw "Stable API did not become healthy at $PublicApiUrl/health. Check DNS/public hostname and $tunnelErr"
}

$dashboardUrl = "$PagesUrl/?api=$PublicApiUrl"
$state = [ordered]@{
  generatedAt = (Get-Date).ToString("o")
  apiLocalUrl = $ApiUrl
  apiPublicUrl = $PublicApiUrl
  dashboardUrl = $dashboardUrl
  tunnelMode = $tunnelMode
  tunnelName = $TunnelName
  cloudflaredPid = $cloudflared.Id
}
$statePath = Join-Path $runtimeDir "stable-stack.json"
$state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

Write-Host "Stable API: $PublicApiUrl"
Write-Host "Dashboard: $dashboardUrl"
Write-Host "State: $statePath"
