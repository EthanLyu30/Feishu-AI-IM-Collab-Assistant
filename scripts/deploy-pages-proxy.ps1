param(
  [string]$ProjectRoot = (Resolve-Path ".").Path,
  [string]$ProjectName = "feishu-ai-im-collab-assistant",
  [string]$PagesUrl = "https://feishu-ai-im-collab-assistant.pages.dev",
  [string]$UpstreamApiUrl = ""
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

function Invoke-LoggedProcess([string]$FilePath, [string[]]$Arguments, [string]$Name) {
  $out = Join-Path $runtimeDir "$Name.out.log"
  $err = Join-Path $runtimeDir "$Name.err.log"
  Remove-Item -LiteralPath $out, $err -ErrorAction SilentlyContinue
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -Wait -PassThru
  if (Test-Path -LiteralPath $out) {
    Get-Content -LiteralPath $out | ForEach-Object { Write-Host $_ }
  }
  if (Test-Path -LiteralPath $err) {
    Get-Content -LiteralPath $err | ForEach-Object { Write-Host $_ }
  }
  if ($process.ExitCode -ne 0) {
    throw "$Name failed with exit code $($process.ExitCode). Logs: $out, $err"
  }
}

Import-DotEnv (Join-Path $ProjectRoot ".env")
Import-DotEnv (Join-Path $ProjectRoot ".env.local")

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

Write-Host "== Set Cloudflare Pages runtime upstream =="
$secretFile = Join-Path $runtimeDir "pages-upstream-api.txt"
Set-Content -LiteralPath $secretFile -Value $UpstreamApiUrl -NoNewline -Encoding ASCII
$secretOut = Join-Path $runtimeDir "pages-secret.out.log"
$secretErr = Join-Path $runtimeDir "pages-secret.err.log"
Remove-Item -LiteralPath $secretOut, $secretErr -ErrorAction SilentlyContinue
$secretCommand = "type `"$secretFile`" | npx --yes wrangler@4.87.0 pages secret put UPSTREAM_API_BASE_URL --project-name $ProjectName"
$secretProcess = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $secretCommand) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $secretOut -RedirectStandardError $secretErr -Wait -PassThru
if (Test-Path -LiteralPath $secretOut) {
  Get-Content -LiteralPath $secretOut | ForEach-Object { Write-Host $_ }
}
if (Test-Path -LiteralPath $secretErr) {
  Get-Content -LiteralPath $secretErr | ForEach-Object { Write-Host $_ }
}
if ($secretProcess.ExitCode -ne 0) {
  throw "Failed to set Pages secret. Logs: $secretOut, $secretErr"
}

Write-Host ""
Write-Host "== Deploy Cloudflare Pages with edge proxy =="
Invoke-LoggedProcess -FilePath "npm.cmd" -Arguments @("run", "deploy:web:cloudflare") -Name "pages-proxy-deploy"

$state = [ordered]@{
  generatedAt = (Get-Date).ToString("o")
  pagesUrl = $PagesUrl
  upstreamApiUrl = $UpstreamApiUrl
  dashboardUrl = $PagesUrl
  edgeHealthUrl = "$PagesUrl/edge/health"
  proxiedReadinessUrl = "$PagesUrl/api/readiness"
}
$statePath = Join-Path $runtimeDir "pages-proxy.json"
$state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

Write-Host ""
Write-Host "Stable Pages dashboard/API: $PagesUrl"
Write-Host "Edge health: $PagesUrl/edge/health"
Write-Host "Readiness through Pages: $PagesUrl/api/readiness"
Write-Host "State: $statePath"
