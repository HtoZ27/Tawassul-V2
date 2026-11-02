param(
  [string]$GlobalDir = "",
  [string]$Bun = "",
  [string]$Log = "",
  [int]$TimeoutSeconds = 180,
  [switch]$ProbeShellLaunch
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$wrapper = Join-Path $repo "scripts\windows-install.cmd"
$script = Join-Path $repo "scripts\windows-install.ps1"
$powershellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$cmdExe = Join-Path $env:SystemRoot "System32\cmd.exe"
$bundle = Join-Path $repo "dist\global.js"
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("tawassul-security-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$report = New-Object System.Collections.Generic.List[string]
$tagged = New-Object System.Collections.Generic.List[string]

function Record([string]$text) {
  Write-Host $text
  $report.Add($text) | Out-Null
}

function Resolve-Bun {
  if ($Bun -and (Test-Path -LiteralPath $Bun)) { return (Resolve-Path -LiteralPath $Bun).Path }
  if ($env:TAWASSUL_BUN -and (Test-Path -LiteralPath $env:TAWASSUL_BUN)) { return (Resolve-Path -LiteralPath $env:TAWASSUL_BUN).Path }
  $command = Get-Command bun -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  foreach ($candidate in @((Join-Path $env:USERPROFILE ".bun\bin\bun.exe"), (Join-Path $env:LOCALAPPDATA "Programs\bun\bun.exe"), (Join-Path $repo "runtime\bun.exe"))) {
    if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  throw "bun was not found; pass -Bun <path>"
}

. "$PSScriptRoot\windows-bounded.ps1"

function Invoke-Ladder([string[]]$arguments, [int]$seconds) {
  return Invoke-BoundedProcess $powershellExe (@("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $script) + $arguments) $seconds
}

function Add-MarkOfTheWeb([string]$file) {
  $body = "[ZoneTransfer]`r`nZoneId=3`r`nHostUrl=https://example.invalid/tawassul.zip`r`nReferrerUrl=https://example.invalid/`r`n"
  Set-Content -LiteralPath $file -Stream "Zone.Identifier" -Value $body -Encoding ASCII
  $tagged.Add($file) | Out-Null
}

function Remove-MarkOfTheWeb([string]$file) {
  Remove-Item -LiteralPath $file -Stream "Zone.Identifier" -ErrorAction SilentlyContinue
}

function Test-MarkOfTheWeb([string]$file) {
  $zone = Get-Content -LiteralPath $file -Stream "Zone.Identifier" -ErrorAction SilentlyContinue
  return [bool]($zone -match "ZoneId=3")
}

function Get-Detections {
  try { return @(Get-MpThreatDetection -ErrorAction Stop).Count } catch { return -1 }
}

function Invoke-ShellProbe([string]$file) {
  $before = @(Get-Process -Name "smartscreen" -ErrorAction SilentlyContinue).Count
  $started = Get-Date
  $process = $null
  try {
    $process = Start-Process -FilePath $file -ArgumentList "--version" -PassThru -ErrorAction Stop
  } catch {
    $detail = $_.Exception.Message
    $cancelled = $detail -match "annul|cancel|abgebrochen|anulad"
    $outcome = if ($cancelled) { "blocked-by-smartscreen" } else { "shell-refused" }
    return @{ Outcome = $outcome; Detail = $detail; Seconds = [Math]::Round(((Get-Date) - $started).TotalSeconds, 1) }
  }
  $deadline = (Get-Date).AddSeconds(20)
  $sawSmartScreen = $false
  $exited = $false
  while ((Get-Date) -lt $deadline) {
    $now = @(Get-Process -Name "smartscreen" -ErrorAction SilentlyContinue).Count
    if ($now -gt $before) { $sawSmartScreen = $true; break }
    try {
      if ($process.HasExited) { $exited = $true; break }
    } catch {
      $exited = $true
      break
    }
    Start-Sleep -Milliseconds 250
  }
  $seconds = [Math]::Round(((Get-Date) - $started).TotalSeconds, 1)
  if (-not $exited -and -not $sawSmartScreen) {
    try { $process.Kill() } catch { }
    return @{ Outcome = "hanging"; Detail = "no exit and no smartscreen within 20s"; Seconds = $seconds }
  }
  if ($sawSmartScreen) {
    try { $process.Kill() } catch { }
    Get-Process -Name "smartscreen" -ErrorAction SilentlyContinue | Select-Object -Skip $before | ForEach-Object { try { $_.Kill() } catch { } }
    return @{ Outcome = "blocked-by-smartscreen"; Detail = "a smartscreen process appeared while launching"; Seconds = $seconds }
  }
  $code = -1
  try { $code = $process.ExitCode } catch { }
  return @{ Outcome = "launched"; Detail = "exit $code"; Seconds = $seconds }
}

$bunPath = Resolve-Bun
if (-not (Test-Path -LiteralPath $bundle)) { throw "dist/global.js is absent; build it first" }
if (-not (Test-Path -LiteralPath $script)) { throw "windows-install.ps1 is absent" }
New-Item -ItemType Directory -Force -Path $work | Out-Null

$status = Get-MpComputerStatus
$preference = Get-MpPreference
Record "windows-security: defender=$($status.AMRunningMode) realtime=$($status.RealTimeProtectionEnabled) behavior=$($status.BehaviorMonitorEnabled) ioav=$($status.IoavProtectionEnabled) onaccess=$($status.OnAccessProtectionEnabled)"
Record "windows-security: signatures=$($status.AntivirusSignatureVersion) age=$($status.AntivirusSignatureAge)d maps=$($preference.MAPSReporting) cloud=$($preference.CloudBlockLevel) pua=$($preference.PUAProtection)"
$smartScreen = (Get-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer" -Name "SmartScreenEnabled" -ErrorAction SilentlyContinue).SmartScreenEnabled
$appHost = Get-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppHost" -ErrorAction SilentlyContinue
$enginePresent = Test-Path (Join-Path $env:SystemRoot "System32\smartscreen.exe")
Record "windows-security: smartscreen=$([string]$smartScreen) engine=$enginePresent apphost=$([bool]$appHost)"
if ($appHost) {
  Record "windows-security: apphost EnableWebContentEvaluation=$([string]$appHost.EnableWebContentEvaluation) ShellSmartScreenLevel=$([string]$appHost.ShellSmartScreenLevel)"
}
$exclusions = try { @((Get-MpPreference).ExclusionPath).Count } catch { -1 }
Record "windows-security: exclusion paths visible=$exclusions (0 means none, -1 means not elevated)"

$beforeCount = Get-Detections
Record "windows-security: detections before=$beforeCount"

try {
  $filesToTag = @(@($script, $bundle) + @($wrapper | Where-Object { $_ -and (Test-Path -LiteralPath $_) }))
  foreach ($file in $filesToTag) { Add-MarkOfTheWeb $file }
  $marked = @($tagged | Where-Object { Test-MarkOfTheWeb $_ }).Count
  Record "windows-security: marked=$marked of $($tagged.Count) repository files with zone 3"
  if ($marked -ne $tagged.Count) { throw "mark-of-the-web did not apply to every repository file" }

  $target = if ($GlobalDir) { $GlobalDir } else { Join-Path $work "opencode" }
  $stateHome = Join-Path $work "home"
  New-Item -ItemType Directory -Force -Path (Join-Path $stateHome ".config\tawassul-v2\state") | Out-Null
  '{}' | Set-Content -LiteralPath (Join-Path $stateHome ".config\tawassul-v2\state\state.json")
  $previousHome = $env:HOME
  $env:HOME = $stateHome

  Record "windows-security: probe 1 - tagged kit through windows-install.ps1"
  $install = Invoke-Ladder @("-Action", "install", "-GlobalDir", $target, "-Bun", $bunPath) $TimeoutSeconds
  Record "windows-security: install exit=$($install.Code) timeout=$($install.TimedOut) seconds=$($install.Seconds)"
  if ($install.Out) { Record ($install.Out.TrimEnd()) }
  if ($install.Err) { Record ($install.Err.TrimEnd()) }

  $verify = Invoke-Ladder @("-Action", "verify", "-GlobalDir", $target, "-Bun", $bunPath) 120
  Record "windows-security: verify exit=$($verify.Code) timeout=$($verify.TimedOut) seconds=$($verify.Seconds)"
  if ($verify.Out) { Record ($verify.Out.TrimEnd()) }

  $shimExit = 0
  if ((Test-Path -LiteralPath $cmdExe) -and (Test-Path -LiteralPath $wrapper)) {
    Record "windows-security: probe 1b - optional cmd shim through windows-install.cmd"
    $shim = Invoke-BoundedProcess $cmdExe @("/c", $wrapper, "-Action", "verify", "-GlobalDir", $target, "-Bun", $bunPath) 120
    $shimExit = $shim.Code
    Record "windows-security: cmd-shim exit=$($shim.Code) timeout=$($shim.TimedOut) seconds=$($shim.Seconds)"
  } else {
    Record "windows-security: cmd-shim=skipped (cmd.exe or windows-install.cmd absent)"
  }

  Record "windows-security: probe 2 - on-demand scan of the installed tree"
  $scan = "not-admin"
  if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    try {
      Start-MpScan -ScanType CustomScan -ScanPath (Join-Path $target "plugins") -ErrorAction Stop
      $scan = "completed"
    } catch { $scan = "failed: " + $_.Exception.Message }
  }
  Record "windows-security: scan=$scan"

  if ($ProbeShellLaunch) {
    Record "windows-security: probe 3 - shell launch of a tagged executable (needs a user decision when SmartScreen blocks)"
    $probeDir = Join-Path $work "probe"
    New-Item -ItemType Directory -Force -Path $probeDir | Out-Null
    $sourceFile = Join-Path $probeDir "probe.ts"
    'console.log("smartscreen-probe");' | Set-Content -LiteralPath $sourceFile -Encoding ASCII
    $probeExe = Join-Path $probeDir "probe.exe"
    $compile = Invoke-BoundedProcess $bunPath @("build", "--compile", $sourceFile, "--outfile", $probeExe) 240
    $probeTarget = $null
    if ($compile.Code -eq 0 -and (Test-Path -LiteralPath $probeExe)) {
      $probeTarget = $probeExe
      Record "windows-security: built an unsigned probe exe ($((Get-Item $probeExe).Length) bytes)"
    } else {
      $probeTarget = Join-Path $probeDir "bun.exe"
      Copy-Item -LiteralPath $bunPath -Destination $probeTarget
      Record "windows-security: compile failed (exit $($compile.Code)); probing the signed bun.exe instead"
    }
    Add-MarkOfTheWeb $probeTarget
    $signature = Get-AuthenticodeSignature $probeTarget
    Record "windows-security: probe target=$([System.IO.Path]::GetFileName($probeTarget)) tagged=$(Test-MarkOfTheWeb $probeTarget) signature=$($signature.Status)"
    $shellResult = Invoke-ShellProbe $probeTarget
    Record "windows-security: shell outcome=$($shellResult.Outcome) detail=$($shellResult.Detail) seconds=$($shellResult.Seconds)"
  } else {
    Record "windows-security: probe 3 skipped; pass -ProbeShellLaunch to test SmartScreen, which waits for a user decision"
  }

  $afterCount = Get-Detections
  Record "windows-security: detections after=$afterCount"
  $threat = @(Get-MpThreat -ErrorAction SilentlyContinue)
  Record "windows-security: recorded threats=$($threat.Count)"
  foreach ($item in $threat) { Record "windows-security: threat $($item.ThreatName) severity=$($item.SeverityID)" }

  Record "windows-security: probe 4 - uninstall through windows-install.ps1"
  $uninstall = Invoke-Ladder @("-Action", "purge", "-GlobalDir", $target, "-Bun", $bunPath) 120
  Record "windows-security: purge exit=$($uninstall.Code) timeout=$($uninstall.TimedOut) seconds=$($uninstall.Seconds)"
  if ($uninstall.Out) { Record ($uninstall.Out.TrimEnd()) }

  $env:HOME = $previousHome

  $verdict = if ($install.Code -eq 0 -and -not $install.TimedOut -and $verify.Code -eq 0 -and $shimExit -eq 0 -and $afterCount -eq $beforeCount) { "PASS" } else { "FAIL" }
  Record "windows-security: verdict=$verdict"
} finally {
  foreach ($file in $tagged) { Remove-MarkOfTheWeb $file }
  $left = @($tagged | Where-Object { Test-MarkOfTheWeb $_ }).Count
  Record "windows-security: tags removed, remaining=$left"
  if ($Log) {
    $report | Set-Content -LiteralPath $Log -Encoding UTF8
  }
}
