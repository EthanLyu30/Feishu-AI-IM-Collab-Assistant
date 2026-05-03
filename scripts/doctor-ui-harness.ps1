param(
  [string]$BaseUrl = "http://localhost:15173",
  [string]$ApiUrl = "http://localhost:18878",
  [string]$OutputDir = ".runtime/ui-harness",
  [switch]$SkipStart,
  [switch]$SkipE2E
)

$ErrorActionPreference = "Continue"

$projectRoot = (Resolve-Path ".").Path
$outputRoot = Join-Path $projectRoot $OutputDir
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

$reportPath = Join-Path $outputRoot "report.md"
$results = New-Object System.Collections.Generic.List[object]
$process = $null

function Add-Result([string]$Name, [bool]$Ok, [string]$Detail, [bool]$Required = $true) {
  $script:results.Add([ordered]@{
    name = $Name
    ok = $Ok
    required = $Required
    detail = $Detail
  }) | Out-Null
}

function Invoke-NpmGate([string]$Name, [string[]]$Arguments, [bool]$Required = $true) {
  $safeName = ($Name -replace "[^a-zA-Z0-9_-]", "-").ToLowerInvariant()
  $out = Join-Path $outputRoot "$safeName.out.log"
  $err = Join-Path $outputRoot "$safeName.err.log"
  Remove-Item -LiteralPath $out, $err -ErrorAction SilentlyContinue

  Write-Host "== $Name =="
  $gate = Start-Process -FilePath "npm.cmd" -ArgumentList $Arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -Wait -PassThru
  $ok = $gate.ExitCode -eq 0
  Add-Result $Name $ok $(if ($ok) { "passed" } else { "failed; logs: $out, $err" }) $Required
}

function Test-Url([string]$Url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Stop-UiHarnessPorts {
  foreach ($port in @(15173, 18878)) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object {
        if ($_ -and $_ -ne $PID) {
          Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
        }
      }
  }
}

Invoke-NpmGate "typecheck" @("run", "typecheck")
Invoke-NpmGate "build web" @("run", "build:web")
if (-not $SkipE2E) {
  Invoke-NpmGate "e2e" @("run", "test:e2e")
} else {
  Add-Result "e2e" $true "skipped by flag" $false
}

try {
  if (-not $SkipStart) {
    Stop-UiHarnessPorts
    $outLog = Join-Path $outputRoot "dev-stack.out.log"
    $errLog = Join-Path $outputRoot "dev-stack.err.log"
    Remove-Item -LiteralPath $outLog, $errLog -ErrorAction SilentlyContinue
    $process = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev:e2e" -WorkingDirectory $projectRoot -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru

    $ready = $false
    $deadline = (Get-Date).AddSeconds(80)
    while (-not $ready -and (Get-Date) -lt $deadline) {
      $ready = (Test-Url $BaseUrl) -and (Test-Url "$ApiUrl/health")
      if (-not $ready) {
        Start-Sleep -Seconds 1
      }
    }
    Add-Result "local stack" $ready "BaseUrl=$BaseUrl ApiUrl=$ApiUrl"
  }

  $auditScript = Join-Path $outputRoot "visual-audit.cjs"
  $baseUrlJson = $BaseUrl | ConvertTo-Json -Compress
  $outputRootJson = $outputRoot | ConvertTo-Json -Compress
  $nodeScript = @'
const { chromium } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const baseUrl = __BASE_URL__;
const outputRoot = __OUTPUT_ROOT__;

function rel(name) {
  return path.join(outputRoot, name);
}

(async () => {
  const browser = await chromium.launch();
  const findings = [];

  async function auditViewport(name, viewport, mobile = false) {
    const page = await browser.newPage({ viewport, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.screenshot({ path: rel(`${name}.png`), fullPage: true });

    const audit = await page.evaluate(() => {
      const body = document.body;
      const main = document.querySelector(".appShell");
      const hasHeading = Boolean([...document.querySelectorAll("h1")].find((item) => item.textContent?.includes("飞书协同 Agent 运行台")));
      const hasCommand = Boolean([...document.querySelectorAll("button")].find((item) => item.textContent?.includes("启动 Agent")));
      const hasRail = Boolean(document.querySelector(".workflowRail"));
      const hasReadiness = Boolean([...document.querySelectorAll("h2")].find((item) => item.textContent?.includes("运行检查")));
      const sceneCount = document.querySelectorAll(".sceneNode").length;
      const hasSceneCoverage = Boolean(document.querySelector(".sceneCoverage")) && sceneCount >= 6;
      const horizontalOverflow = body.scrollWidth - window.innerWidth;
      const panelRadii = [...document.querySelectorAll(".panel, .deckMain, .deckAside, .metricPill")].map((el) => {
        const value = window.getComputedStyle(el).borderRadius.replace("px", "");
        return Number.parseFloat(value) || 0;
      });
      const maxRadius = panelRadii.length ? Math.max(...panelRadii) : 0;
      const blankish = !main || main.getBoundingClientRect().height < 500;
      const textOverflowCount = [...document.querySelectorAll("button, .metricPill, .workflowStage, .readinessRow, .nextAction")].filter((el) => el.scrollWidth > el.clientWidth + 2).length;

      return {
        hasHeading,
        hasCommand,
        hasRail,
        hasReadiness,
        hasSceneCoverage,
        sceneCount,
        horizontalOverflow,
        maxRadius,
        blankish,
        textOverflowCount
      };
    });

    findings.push({ name, ...audit });
    await page.close();
  }

  await auditViewport("desktop", { width: 1440, height: 1000 });
  await auditViewport("mobile", { width: 390, height: 844 }, true);

  await browser.close();
  fs.writeFileSync(rel("visual-audit.json"), JSON.stringify(findings, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
'@

  $nodeScript = $nodeScript.Replace("__BASE_URL__", $baseUrlJson).Replace("__OUTPUT_ROOT__", $outputRootJson)

  Set-Content -LiteralPath $auditScript -Value $nodeScript -Encoding UTF8
  $auditProcess = Start-Process -FilePath "node.exe" -ArgumentList @($auditScript) -WorkingDirectory $projectRoot -WindowStyle Hidden -Wait -PassThru
  Add-Result "visual audit script" ($auditProcess.ExitCode -eq 0) "desktop/mobile screenshot + DOM audit"

  $auditJsonPath = Join-Path $outputRoot "visual-audit.json"
  if (Test-Path -LiteralPath $auditJsonPath) {
    $audits = Get-Content -LiteralPath $auditJsonPath -Raw | ConvertFrom-Json
    foreach ($audit in $audits) {
      Add-Result "$($audit.name) visible shell" ([bool]($audit.hasHeading -and $audit.hasCommand -and $audit.hasRail -and $audit.hasReadiness -and -not $audit.blankish)) "heading/button/rail/readiness present"
      Add-Result "$($audit.name) scenario coverage" ([bool]$audit.hasSceneCoverage) "sceneCount=$($audit.sceneCount)"
      Add-Result "$($audit.name) no horizontal overflow" ([double]$audit.horizontalOverflow -le 2) "overflow=$($audit.horizontalOverflow)px"
      Add-Result "$($audit.name) card radius gate" ([double]$audit.maxRadius -le 8) "maxRadius=$($audit.maxRadius)px"
      Add-Result "$($audit.name) text overflow budget" ([int]$audit.textOverflowCount -le 1) "overflowCount=$($audit.textOverflowCount)" $false
    }
  } else {
    Add-Result "visual audit data" $false "missing $auditJsonPath"
  }
} finally {
  if ($process) {
    Stop-UiHarnessPorts
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
}

$requiredFailed = $results | Where-Object { $_.required -and -not $_.ok }
$generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("# UI Harness Report") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("Generated: $generatedAt") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("| Gate | Result | Required | Detail |") | Out-Null
$lines.Add("| --- | --- | --- | --- |") | Out-Null
foreach ($result in $results) {
  $state = if ($result.ok) { "pass" } else { "fail" }
  $required = if ($result.required) { "yes" } else { "no" }
  $detail = $result.detail -replace "\|", "/"
  $lines.Add("| $($result.name) | $state | $required | $detail |") | Out-Null
}
$lines.Add("") | Out-Null
$lines.Add("Screenshots:") | Out-Null
$lines.Add("- ``$OutputDir/desktop.png``") | Out-Null
$lines.Add("- ``$OutputDir/mobile.png``") | Out-Null
$lines | Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Host "Report: $reportPath"

if ($requiredFailed.Count -gt 0) {
  exit 1
}
