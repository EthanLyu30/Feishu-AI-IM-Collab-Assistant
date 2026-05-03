param(
  [string]$ApiUrl = "http://localhost:8787",
  [string]$PublicWebUrl = "",
  [switch]$SkipRuntime,
  [switch]$SkipLarkCli,
  [switch]$SkipE2E
)

$ErrorActionPreference = "Continue"

$projectRoot = (Resolve-Path ".").Path
$runtimeDir = Join-Path $projectRoot ".runtime"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$reportPath = Join-Path $runtimeDir "delivery-report.md"
$results = New-Object System.Collections.Generic.List[object]
$manualActions = New-Object System.Collections.Generic.List[string]

function Add-Result([string]$Name, [bool]$Ok, [string]$Detail, [bool]$Required = $true) {
  $script:results.Add([ordered]@{
    name = $Name
    ok = $Ok
    required = $Required
    detail = $Detail
  }) | Out-Null
}

function Invoke-Gate([string]$Name, [string[]]$Arguments, [bool]$Required = $true) {
  $safeName = ($Name -replace "[^a-zA-Z0-9_-]", "-").ToLowerInvariant()
  $out = Join-Path $runtimeDir "$safeName.out.log"
  $err = Join-Path $runtimeDir "$safeName.err.log"
  Remove-Item -LiteralPath $out, $err -ErrorAction SilentlyContinue

  Write-Host "== $Name =="
  $process = Start-Process -FilePath "npm.cmd" -ArgumentList $Arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -Wait -PassThru
  $ok = $process.ExitCode -eq 0
  $detail = if ($ok) { "passed" } else { "failed; logs: $out, $err" }
  Add-Result $Name $ok $detail $Required
  if (-not $ok) {
    Write-Warning "$Name failed. See $out and $err"
  }
}

function Import-DotEnvValues {
  $values = @{}
  foreach ($path in @((Join-Path $projectRoot ".env"), (Join-Path $projectRoot ".env.local"))) {
    if (-not (Test-Path -LiteralPath $path)) {
      continue
    }

    foreach ($line in Get-Content -LiteralPath $path) {
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
      $values[$key] = $value
    }
  }
  return $values
}

function Test-Url([string]$Url) {
  if (-not $Url) {
    return $false
  }
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 12
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

Invoke-Gate "typecheck" @("run", "typecheck")
Invoke-Gate "build" @("run", "build")
if (-not $SkipE2E) {
  Invoke-Gate "e2e" @("run", "test:e2e")
} else {
  Add-Result "e2e" $true "skipped by flag" $false
}

if (-not $SkipRuntime) {
  $runtimeArgs = @("run", "doctor:runtime", "--", "-ApiUrl", $ApiUrl)
  if ($SkipLarkCli) {
    $runtimeArgs += "-SkipLarkCli"
  }
  Invoke-Gate "runtime doctor" $runtimeArgs $false
} else {
  Add-Result "runtime doctor" $true "skipped by flag" $false
}

$envValues = Import-DotEnvValues

if (($envValues["AGENT_LLM_MODE"] -ne "doubao") -or -not $envValues["ARK_ENDPOINT_ID"] -or -not $envValues["ARK_API_KEY"]) {
  $manualActions.Add('确认 `.env` 中 `AGENT_LLM_MODE=doubao`，并填入 Ark Endpoint 与 API Key。') | Out-Null
}
if ($envValues["OFFICE_ADAPTER"] -ne "lark-cli") {
  $manualActions.Add('确认 `.env` 中 `OFFICE_ADAPTER=lark-cli`，否则真实飞书 Docs / Slides 不会写入。') | Out-Null
}
if (-not $envValues["LARK_DEFAULT_CHAT_ID"]) {
  $manualActions.Add('填写 `LARK_DEFAULT_CHAT_ID` 为比赛测试群会话 ID。') | Out-Null
}
if (-not $envValues["LARK_ALLOWED_CHAT_IDS"]) {
  $manualActions.Add('真实演示前建议填写 `LARK_ALLOWED_CHAT_IDS`，限制只有测试群能触发 Agent。') | Out-Null
}
if (-not ($envValues["LARK_BOT_OPEN_ID"] -or $envValues["LARK_BOT_USER_ID"])) {
  $manualActions.Add('建议填写 `LARK_BOT_OPEN_ID` 或 `LARK_BOT_USER_ID`，降低机器人自消息循环风险。') | Out-Null
}
$publicWebBaseUrl = $envValues["PUBLIC_WEB_BASE_URL"]
if ($PublicWebUrl) {
  $publicWebBaseUrl = $PublicWebUrl
}
if (-not $publicWebBaseUrl) {
  $publicWebBaseUrl = "https://agent-pilot.47-236-122-49.sslip.io"
}
Add-Result "public web url" $true $publicWebBaseUrl $false

$publicWebOk = Test-Url $publicWebBaseUrl
Add-Result "public web health" $publicWebOk $publicWebBaseUrl $false
if (-not $publicWebOk) {
  $manualActions.Add("公网 Web 入口不可访问，请检查 Nginx、证书和服务器安全组。") | Out-Null
}

$pagesProxyState = Join-Path $runtimeDir "pages-proxy.json"
if ($publicWebBaseUrl -like "*.pages.dev*" -and (Test-Path -LiteralPath $pagesProxyState)) {
  try {
    $state = Get-Content -LiteralPath $pagesProxyState -Raw | ConvertFrom-Json
    $edgeOk = Test-Url $state.edgeHealthUrl
    Add-Result "pages edge health" $edgeOk $state.edgeHealthUrl $false
    if (-not $edgeOk) {
      $manualActions.Add('Cloudflare Pages 边缘代理健康检查未通过，重新运行 `npm run deploy:web-proxy:cloudflare`。') | Out-Null
    }
  } catch {
    Add-Result "pages edge health" $false "failed to read .runtime/pages-proxy.json" $false
  }
} else {
  Add-Result "pages edge health" $true "not used by current server deployment" $false
}

if ($manualActions.Count -eq 0) {
  $manualActions.Add("暂无阻塞性人工操作；继续做真实飞书群聊端到端演示录屏。") | Out-Null
}

$requiredFailed = $results | Where-Object { $_.required -and -not $_.ok }
$generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("# Agent-Pilot 交付前诊断报告") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("生成时间：$generatedAt") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("## 自动检查") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("| 检查项 | 结果 | 必需 | 说明 |") | Out-Null
$lines.Add("| --- | --- | --- | --- |") | Out-Null
foreach ($result in $results) {
  $state = if ($result.ok) { "通过" } else { "未通过" }
  $required = if ($result.required) { "是" } else { "否" }
  $detail = $result.detail -replace "\|", "/"
  $lines.Add("| $($result.name) | $state | $required | $detail |") | Out-Null
}
$lines.Add("") | Out-Null
$lines.Add("## 人工操作清单") | Out-Null
$lines.Add("") | Out-Null
foreach ($action in $manualActions) {
  $lines.Add("- $action") | Out-Null
}
$lines.Add("") | Out-Null
$lines.Add("## 结论") | Out-Null
$lines.Add("") | Out-Null
if ($requiredFailed.Count -gt 0) {
  $lines.Add("当前仍有必需检查未通过，暂不建议进入正式演示。") | Out-Null
} else {
  $lines.Add("代码级质量门禁已通过；正式演示前重点确认飞书后台版本发布、机器人菜单缓存、群聊真实触发和 Slides 打开非空。") | Out-Null
}

$lines | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host "Report: $reportPath"

if ($requiredFailed.Count -gt 0) {
  exit 1
}
