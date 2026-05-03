param(
  [string]$ApiUrl = "http://localhost:8787",
  [switch]$SkipLarkCli
)

$ErrorActionPreference = "Continue"

function Invoke-Json([string]$Url) {
  try {
    return Invoke-RestMethod -Uri $Url -TimeoutSec 15
  } catch {
    Write-Warning "$Url failed: $($_.Exception.Message)"
    return $null
  }
}

function Invoke-ShortCommand([string]$FilePath, [string[]]$Arguments, [int]$TimeoutSeconds = 20) {
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -NoNewWindow -PassThru -RedirectStandardOutput ".runtime\doctor-command.out.log" -RedirectStandardError ".runtime\doctor-command.err.log"
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    $process.Kill()
    return @{ ok = $false; output = "Timed out after $TimeoutSeconds seconds." }
  }

  $out = if (Test-Path ".runtime\doctor-command.out.log") { Get-Content ".runtime\doctor-command.out.log" -Raw } else { "" }
  $err = if (Test-Path ".runtime\doctor-command.err.log") { Get-Content ".runtime\doctor-command.err.log" -Raw } else { "" }
  return @{ ok = $process.ExitCode -eq 0; output = ($out + $err).Trim() }
}

New-Item -ItemType Directory -Force -Path ".runtime" | Out-Null

Write-Host "== Agent-Pilot Runtime Doctor =="
Write-Host "API: $ApiUrl"

Write-Host ""
Write-Host "== Node =="
node --version
npm --version

Write-Host ""
Write-Host "== API health =="
$health = Invoke-Json "$ApiUrl/health"
if ($health) {
  $health | ConvertTo-Json -Depth 8
}

Write-Host ""
Write-Host "== Readiness =="
$readiness = Invoke-Json "$ApiUrl/api/readiness"
if ($readiness) {
  Write-Host "overall: $($readiness.ok)"
  foreach ($check in $readiness.checks) {
    $state = if ($check.ok) { "OK" } elseif ($check.required) { "BLOCK" } else { "TODO" }
    Write-Host "[$state] $($check.label) - $($check.detail)"
  }
}

if (-not $SkipLarkCli) {
  Write-Host ""
  Write-Host "== lark-cli =="
  $larkCommand = Get-Command lark-cli -ErrorAction SilentlyContinue
  if ($larkCommand?.Source) {
    Write-Host "lark-cli: $($larkCommand.Source)"
    $doctor = Invoke-ShortCommand -FilePath "lark-cli" -Arguments @("doctor") -TimeoutSeconds 30
    if ($doctor.ok) {
      Write-Host "lark-cli doctor: OK"
    } else {
      Write-Warning "lark-cli doctor needs attention: $($doctor.output)"
    }
  } else {
    Write-Warning "lark-cli not found in PATH."
  }
}

Write-Host ""
Write-Host "== Suggested next checks =="
Write-Host "1. If required readiness is false, fix .env before demo."
Write-Host "2. If lark-cli doctor fails, rerun lark-cli auth login or check proxy settings."
Write-Host "3. If Pages is used, run npm run doctor:stable-api before Feishu menu demo."
