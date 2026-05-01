param(
  [string]$ProjectName = "feishu-ai-im-collab-assistant",
  [string]$PagesUrl = "https://feishu-ai-im-collab-assistant.pages.dev"
)

$ErrorActionPreference = "Continue"

Write-Host "== Cloudflare auth =="
npx wrangler whoami

Write-Host ""
Write-Host "== Cloudflare Pages project =="
npx wrangler pages project list

Write-Host ""
Write-Host "== Recent deployments =="
npx wrangler pages deployment list --project-name $ProjectName

Write-Host ""
Write-Host "== HTTP reachability =="
try {
  $response = Invoke-WebRequest -Uri $PagesUrl -Method Head -UseBasicParsing -TimeoutSec 30
  Write-Host "Reachable: $PagesUrl -> HTTP $($response.StatusCode)"
} catch {
  Write-Warning "PowerShell HTTP check failed: $($_.Exception.Message)"
  Write-Host "Retrying with curl.exe..."
  curl.exe -I -L --max-time 30 $PagesUrl
}
