param(
  [string]$ProjectRoot = (Resolve-Path ".").Path,
  [string]$PublicApiUrl = "",
  [string]$PagesUrl = ""
)

$ErrorActionPreference = "Continue"

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

function Invoke-Json([string]$Url) {
  try {
    return Invoke-RestMethod -Uri $Url -TimeoutSec 20
  } catch {
    Write-Warning "$Url failed: $($_.Exception.Message)"
    return $null
  }
}

Import-DotEnv (Join-Path $ProjectRoot ".env")
Import-DotEnv (Join-Path $ProjectRoot ".env.local")

if (-not $PublicApiUrl -and $env:PUBLIC_API_BASE_URL) {
  $PublicApiUrl = $env:PUBLIC_API_BASE_URL
}
if (-not $PagesUrl) {
  $PagesUrl = if ($env:PUBLIC_WEB_BASE_URL) { $env:PUBLIC_WEB_BASE_URL } else { "https://feishu-ai-im-collab-assistant.pages.dev" }
}
if (-not $PublicApiUrl) {
  $pagesProxyState = Join-Path $ProjectRoot ".runtime\pages-proxy.json"
  if (Test-Path -LiteralPath $pagesProxyState) {
    $state = Get-Content -LiteralPath $pagesProxyState -Raw | ConvertFrom-Json
    $PublicApiUrl = $state.pagesUrl
    $PagesUrl = $state.pagesUrl
  }
}

if (-not $PublicApiUrl) {
  Write-Warning "No stable API configured. Set PUBLIC_API_BASE_URL, pass -PublicApiUrl, or run npm run deploy:web-proxy:cloudflare."
  exit 1
}

$PublicApiUrl = $PublicApiUrl.TrimEnd("/")
$isPagesProxy = $PublicApiUrl -eq $PagesUrl.TrimEnd("/")
$healthUrl = if ($isPagesProxy) { "$PublicApiUrl/edge/health" } else { "$PublicApiUrl/health" }
$readinessUrl = "$PublicApiUrl/api/readiness"

Write-Host "== Stable API =="
Write-Host $PublicApiUrl

Write-Host ""
Write-Host "== Health =="
$health = Invoke-Json $healthUrl
if ($health) {
  $health | ConvertTo-Json -Depth 8
}

Write-Host ""
Write-Host "== Readiness =="
$readiness = Invoke-Json $readinessUrl
if ($readiness) {
  Write-Host "overall: $($readiness.ok)"
  foreach ($check in $readiness.checks) {
    $state = if ($check.ok) { "OK" } else { "TODO" }
    Write-Host "[$state] $($check.label) - $($check.detail)"
  }
}

Write-Host ""
Write-Host "== Feishu dashboard URL =="
if ($isPagesProxy) {
  Write-Host $PagesUrl
} else {
  Write-Host "$PagesUrl/?api=$PublicApiUrl"
}
