param(
  [string]$ProjectRoot = (Resolve-Path ".").Path,
  [string]$UpstreamApiUrl = "",
  [string]$WorkerName = "feishu-agent-api-relay",
  [string]$PagesUrl = ""
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
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 15
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

Import-DotEnv (Join-Path $ProjectRoot ".env")
Import-DotEnv (Join-Path $ProjectRoot ".env.local")

if (-not $PagesUrl) {
  $PagesUrl = if ($env:PUBLIC_WEB_BASE_URL) { $env:PUBLIC_WEB_BASE_URL } else { "https://feishu-ai-im-collab-assistant.pages.dev" }
}

if (-not $UpstreamApiUrl) {
  $runtimeState = Join-Path $ProjectRoot ".runtime\demo-stack.json"
  if (Test-Path -LiteralPath $runtimeState) {
    $state = Get-Content -LiteralPath $runtimeState -Raw | ConvertFrom-Json
    $UpstreamApiUrl = $state.apiPublicUrl
  }
}
if (-not $UpstreamApiUrl -and $env:UPSTREAM_API_BASE_URL) {
  $UpstreamApiUrl = $env:UPSTREAM_API_BASE_URL
}
if (-not $UpstreamApiUrl -and $env:PUBLIC_API_BASE_URL) {
  $UpstreamApiUrl = $env:PUBLIC_API_BASE_URL
}

if (-not $UpstreamApiUrl) {
  throw "No upstream API URL found. Run npm run demo:stack first, or pass -UpstreamApiUrl https://your-api.example.com"
}

$UpstreamApiUrl = $UpstreamApiUrl.TrimEnd("/")
if (-not (Test-HttpOk "$UpstreamApiUrl/health")) {
  throw "Upstream API is not healthy at $UpstreamApiUrl/health"
}

$runtimeDir = Join-Path $ProjectRoot ".runtime"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$workerDir = Join-Path $ProjectRoot "workers\api-relay"
$wranglerConfig = Join-Path $workerDir "wrangler.jsonc"
$varArg = "UPSTREAM_API_BASE_URL:$UpstreamApiUrl"
$deployOut = Join-Path $runtimeDir "api-relay-deploy.out.log"
$deployErr = Join-Path $runtimeDir "api-relay-deploy.err.log"
Remove-Item -LiteralPath $deployOut, $deployErr -ErrorAction SilentlyContinue

Write-Host "Deploying $WorkerName with upstream $UpstreamApiUrl"
$process = Start-Process -FilePath "npx.cmd" -ArgumentList @(
  "wrangler",
  "deploy",
  "--config",
  $wranglerConfig,
  "--name",
  $WorkerName,
  "--var",
  $varArg,
  "--keep-vars"
) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $deployOut -RedirectStandardError $deployErr -Wait -PassThru

$output = @()
if (Test-Path -LiteralPath $deployOut) {
  $output += Get-Content -LiteralPath $deployOut
}
if (Test-Path -LiteralPath $deployErr) {
  $output += Get-Content -LiteralPath $deployErr
}
$output | ForEach-Object { Write-Host $_ }

if ($process.ExitCode -ne 0) {
  throw "Wrangler deploy failed with exit code $($process.ExitCode). Logs: $deployOut, $deployErr"
}

$relayUrl = (($output | Out-String) | Select-String -Pattern "https://[a-zA-Z0-9.-]+\.workers\.dev" -AllMatches).Matches |
  Select-Object -First 1 -ExpandProperty Value

if (-not $relayUrl) {
  Write-Warning "Could not parse workers.dev URL from Wrangler output. Check Cloudflare dashboard for $WorkerName."
  return
}

$relayUrl = $relayUrl.TrimEnd("/")
$state = [ordered]@{
  generatedAt = (Get-Date).ToString("o")
  workerName = $WorkerName
  relayApiUrl = $relayUrl
  upstreamApiUrl = $UpstreamApiUrl
  dashboardUrl = "$PagesUrl/?api=$relayUrl"
}
$statePath = Join-Path $runtimeDir "api-relay.json"
$state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

Write-Host ""
Write-Host "Stable relay API: $relayUrl"
Write-Host "Feishu dashboard URL: $PagesUrl/?api=$relayUrl"
Write-Host "State: $statePath"
