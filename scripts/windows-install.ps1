param(
  [ValidateSet("install", "verify", "uninstall", "purge", "cycle")]
  [string]$Action = "install",
  [string]$GlobalDir = "",
  [string]$Bun = "",
  [string]$Log = "",
  [string]$StateRoot = "",
  [switch]$KeepState,
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $repo "scripts\install-global.ts"
$bundle = Join-Path $repo "dist\global.js"
$transcript = New-Object System.Collections.Generic.List[string]

function Write-Step([string]$text) {
  $line = "windows-install: $text"
  Write-Host $line
  $transcript.Add($line) | Out-Null
}

function Resolve-Bun {
  $candidates = @()
  if ($Bun) { $candidates += $Bun }
  if ($env:TAWASSUL_BUN) { $candidates += $env:TAWASSUL_BUN }
  $command = Get-Command bun -ErrorAction SilentlyContinue
  if ($command) { $candidates += $command.Source }
  if ($env:USERPROFILE) { $candidates += (Join-Path $env:USERPROFILE ".bun\bin\bun.exe") }
  if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA "Programs\bun\bun.exe") }
  $candidates += (Join-Path $repo "runtime\bun.exe")
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  throw "bun was not found; pass -Bun <path> or set TAWASSUL_BUN"
}

. "$PSScriptRoot\windows-bounded.ps1"

function Invoke-Bounded([string]$file, [string[]]$arguments, [int]$seconds) {
  $result = Invoke-BoundedProcess $file $arguments $seconds
  if ($result.TimedOut) { throw "$file did not finish within $seconds seconds" }
  if ($result.Out) { Write-Host $result.Out.TrimEnd() }
  if ($result.Err) { Write-Host $result.Err.TrimEnd() }
  return $result.Code
}

function Invoke-Installer([string[]]$arguments) {
  $label = if ($arguments.Count -gt 0) { $arguments -join " " } else { "install" }
  $started = Get-Date
  $code = Invoke-Bounded $bunPath (@($installer) + $arguments) $TimeoutSeconds
  $seconds = [Math]::Round(((Get-Date) - $started).TotalSeconds, 1)
  if ($code -ne 0) { throw "install-global exited $code for: $label after $seconds seconds" }
  Write-Step "install-global $label exit=$code seconds=$seconds"
}

function Invoke-Build {
  if (Test-Path -LiteralPath $bundle) { return }
  Write-Step "dist/global.js is absent; building it first (this is the slow first run)"
  $started = Get-Date
  $code = Invoke-Bounded $bunPath @((Join-Path $repo "build-v2.mjs")) ([Math]::Max($TimeoutSeconds, 300))
  $seconds = [Math]::Round(((Get-Date) - $started).TotalSeconds, 1)
  if ($code -ne 0) { throw "build-v2.mjs exited $code after $seconds seconds" }
  Write-Step "build-v2.mjs exit=$code seconds=$seconds"
}

$bunPath = Resolve-Bun
$isolatedState = $false
if (-not $StateRoot -and $Action -eq "cycle") {
  $StateRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tawassul-cycle-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
  $isolatedState = $true
}
if ($StateRoot) {
  New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
  $StateRoot = (Resolve-Path -LiteralPath $StateRoot).Path
  $env:HOME = $StateRoot
  $env:XDG_CONFIG_HOME = Join-Path $StateRoot ".config"
  $env:XDG_DATA_HOME = Join-Path $StateRoot ".local\share"
  Write-Step "state isolated at: $StateRoot"
}
if ($GlobalDir) { $env:TAWASSUL_GLOBAL_DIR = $GlobalDir }
$env:TAWASSUL_REGISTER_TRIGGERS = "off"

Write-Step "action=$Action bun=$bunPath"
if ($GlobalDir) { Write-Step "global directory: $GlobalDir" }

try {
  switch ($Action) {
  "install" {
    Invoke-Build
    Invoke-Installer @()
    Invoke-Installer @("--verify")
  }
  "verify" {
    Invoke-Installer @("--verify")
  }
  "uninstall" {
    Invoke-Installer @("--uninstall")
  }
  "purge" {
    Invoke-Installer @("--uninstall", "--purge", "--yes")
  }
  "cycle" {
    Invoke-Build
    Invoke-Installer @()
    Invoke-Installer @("--verify")
    $configBase = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { Join-Path $env:USERPROFILE ".config" }
    $marker = if ($GlobalDir) { Join-Path $GlobalDir "tawassul-runtime\VERSION" } else { Join-Path $configBase "opencode\tawassul-runtime\VERSION" }
    if (Test-Path -LiteralPath $marker) {
      $text = Get-Content -LiteralPath $marker -Raw
      $patched = $text -replace '"version": "[^"]+"', '"version": "0.0.0-receipt"'
      Set-Content -LiteralPath $marker -Value $patched -NoNewline
      Write-Step "marker version lowered to exercise the in-place upgrade path"
      Invoke-Installer @()
      Invoke-Installer @("--verify")
    }
    Invoke-Installer @("--uninstall", "--purge", "--yes")
  }
  }
} catch {
  Write-Step "FAIL ($Action): $($_.Exception.Message)"
  if ($Log) { $transcript | Set-Content -LiteralPath $Log -Encoding UTF8 }
  exit 1
} finally {
  if ($isolatedState -and -not $KeepState -and (Test-Path -LiteralPath $StateRoot)) {
    Remove-Item -LiteralPath $StateRoot -Recurse -Force -ErrorAction SilentlyContinue
    Write-Step "removed the isolated state at: $StateRoot"
  }
}

if ($Log) {
  $transcript | Set-Content -LiteralPath $Log -Encoding UTF8
  Write-Step "receipt written to $Log"
}
Write-Step "PASS ($Action)"
