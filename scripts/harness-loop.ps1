param(
  [int]$Rounds = 3,
  [string]$BaseUrl = "http://localhost:15173",
  [string]$ApiUrl = "http://localhost:18878",
  [switch]$SkipE2E
)

$ErrorActionPreference = "Continue"

$projectRoot = (Resolve-Path ".").Path
$outputRoot = Join-Path $projectRoot ".runtime/harness-loop"
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

$reportPath = Join-Path $outputRoot "report.md"
$rows = New-Object System.Collections.Generic.List[string]
$rows.Add("# Harness Loop Report") | Out-Null
$rows.Add("") | Out-Null
$rows.Add("Generated: $((Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz"))") | Out-Null
$rows.Add("") | Out-Null
$rows.Add("| Round | Result | Detail |") | Out-Null
$rows.Add("| --- | --- | --- |") | Out-Null

$failed = $false

for ($index = 1; $index -le $Rounds; $index++) {
  $roundDir = Join-Path ".runtime/harness-loop" ("round-" + $index)
  $args = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "scripts/doctor-ui-harness.ps1",
    "-BaseUrl",
    $BaseUrl,
    "-ApiUrl",
    $ApiUrl,
    "-OutputDir",
    $roundDir
  )

  if ($SkipE2E) {
    $args += "-SkipE2E"
  }

  Write-Host "== Harness round $index/$Rounds =="
  $process = Start-Process -FilePath "powershell.exe" -ArgumentList $args -WorkingDirectory $projectRoot -NoNewWindow -Wait -PassThru
  $result = if ($process.ExitCode -eq 0) { "pass" } else { "fail" }
  $detail = "$roundDir/report.md"
  $rows.Add("| $index | $result | $detail |") | Out-Null

  if ($process.ExitCode -ne 0) {
    $failed = $true
    break
  }
}

$rows | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host "Loop report: $reportPath"

if ($failed) {
  exit 1
}
