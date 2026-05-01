param(
  [string]$TargetUrl = "http://localhost:8787"
)

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue

if (-not $cloudflared) {
  Write-Error @"
cloudflared is not installed or is not in PATH.

Install it from Cloudflare, then rerun:
  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

Target service:
  $TargetUrl
"@
  exit 1
}

Write-Host "Starting Cloudflare quick tunnel for $TargetUrl"
Write-Host "Copy the generated https://*.trycloudflare.com URL into VITE_API_BASE_URL for a temporary demo."
cloudflared tunnel --url $TargetUrl
