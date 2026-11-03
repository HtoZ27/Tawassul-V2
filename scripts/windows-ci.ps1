param(
  [ValidateSet("cycle", "pwsh7", "longpath", "ast")]
  [string]$Mode = "cycle",
  [string]$Bun = "",
  [string]$Log = ""
)

$ErrorActionPreference = "Stop"
$scriptsRoot = $PSScriptRoot
$repo = Split-Path -Parent $scriptsRoot
$installer = Join-Path $scriptsRoot "install-global.ts"
$icaclsExe = Join-Path $env:SystemRoot "System32\icacls.exe"
$runner = Join-Path ([System.IO.Path]::GetTempPath()) ("tawassul-ci-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$guardId = [guid]::NewGuid().ToString("N").Substring(0, 8)
$lines = New-Object System.Collections.Generic.List[string]
$bunPath = $Bun

New-Item -ItemType Directory -Force -Path $runner | Out-Null
. "$PSScriptRoot\windows-bounded.ps1"

function Note([string]$text) {
  $line = "windows-ci: $text"
  Write-Host $line
  $lines.Add($line) | Out-Null
}

function Assert-True([bool]$condition, [string]$message) {
  if (-not $condition) { throw "assertion failed: $message" }
}

function Resolve-BunPath {
  if ($bunPath) { return $bunPath }
  $command = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $command) { throw "bun was not found on PATH; pass -Bun or install Bun first" }
  return $command.Source
}

function Invoke-Native([string]$file, [string[]]$arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $file @arguments 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  foreach ($entry in $output) { Write-Host $entry; $lines.Add("  " + $entry) | Out-Null }
  return @{ Code = $code; Out = ($output -join "`n") }
}

function Invoke-Installer([string[]]$arguments, [int]$seconds = 180) {
  $result = Invoke-BoundedProcess $bunPath (@($installer) + $arguments) $seconds
  if ($result.Out) { Write-Host $result.Out; $lines.Add("  " + $result.Out) | Out-Null }
  if ($result.Err) { Write-Host $result.Err; $lines.Add("  " + $result.Err) | Out-Null }
  return $result
}

function Invoke-Build {
  $result = Invoke-BoundedProcess $bunPath @((Join-Path $repo "build-v2.mjs")) 300
  if ($result.Out) { Write-Host $result.Out; $lines.Add("  " + $result.Out) | Out-Null }
  if ($result.Err) { Write-Host $result.Err; $lines.Add("  " + $result.Err) | Out-Null }
  Assert-True ($result.Code -eq 0) "build-v2.mjs exited $($result.Code)"
  Assert-True (-not $result.TimedOut) "build-v2.mjs timed out"
}

function Set-IsolatedHome([string]$root) {
  $homeDir = Join-Path $root "home"
  New-Item -ItemType Directory -Force -Path (Join-Path $homeDir ".config") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $homeDir ".local\share") | Out-Null
  $env:HOME = $homeDir
  $env:XDG_CONFIG_HOME = Join-Path $homeDir ".config"
  $env:XDG_DATA_HOME = Join-Path $homeDir ".local\share"
  $env:TAWASSUL_CACHE_DIR = Join-Path $homeDir ".cache"
  $env:TAWASSUL_GLOBAL_DIR = Join-Path $root "opencode"
  return $env:TAWASSUL_GLOBAL_DIR
}

function Get-RealStatePaths {
  return @(
    (Join-Path $env:USERPROFILE ".config\tawassul-v2"),
    (Join-Path $env:USERPROFILE ".local\share\tawassul-v2")
  )
}

function Plant-Guards {
  $files = @()
  foreach ($base in Get-RealStatePaths) {
    if (-not (Test-Path -LiteralPath $base)) { continue }
    $file = Join-Path $base ("windows-ci-guard-" + $guardId + ".txt")
    Set-Content -LiteralPath $file -Value $guardId -Encoding ASCII
    $files += $file
  }
  return $files
}

function Assert-Guards([string[]]$files) {
  foreach ($file in $files) {
    Assert-True (Test-Path -LiteralPath $file) "the cycle removed real state at $file"
    $value = (Get-Content -LiteralPath $file -Raw).Trim()
    Assert-True ($value -eq $guardId) "the cycle rewrote real state at $file"
  }
}

function Get-PurgeArchives {
  $count = 0
  foreach ($base in @((Join-Path $env:USERPROFILE ".config"), (Join-Path $env:USERPROFILE ".local\share"))) {
    if (Test-Path -LiteralPath $base) {
      $count += @(Get-ChildItem -LiteralPath $base -Directory -Filter "tawassul-v2.purged-*" -ErrorAction SilentlyContinue).Count
    }
  }
  return $count
}

function Assert-KeyAcl([string]$keyDir) {
  Assert-True (Test-Path -LiteralPath $keyDir) "the key directory $keyDir was not created"
  $acl = Get-Acl -LiteralPath $keyDir
  $explicit = @($acl.Access | Where-Object { -not $_.IsInherited })
  $inherited = @($acl.Access | Where-Object { $_.IsInherited })
  Note "key acl explicit=$($explicit.Count) inherited=$($inherited.Count)"
  Assert-True ($explicit.Count -eq 3) "expected 3 explicit ACEs on the key directory, found $($explicit.Count)"
  Assert-True ($inherited.Count -eq 0) "expected no inherited ACEs on the key directory, found $($inherited.Count)"
  foreach ($entry in $explicit) {
    Assert-True (-not ($entry.IdentityReference.Value -match "Everyone|Tout le monde")) "the key directory grants Everyone"
  }
}

function Invoke-CycleBody([string]$label, [string[]]$guards, [int]$archivesBefore) {
  $globalDir = Set-IsolatedHome $runner
  $started = Get-Date
  Invoke-Build
  $installed = Invoke-Installer @()
  Assert-True ($installed.Code -eq 0) "install exited $($installed.Code)"
  Assert-True (-not $installed.TimedOut) "install timed out"
  Assert-True ($installed.Out -match "installed ") "install did not report an install"
  $verified = Invoke-Installer @("--verify")
  Assert-True ($verified.Code -eq 0) "verify exited $($verified.Code)"
  Assert-True (-not $verified.TimedOut) "verify timed out"
  Assert-True ($verified.Out -match "verified ") "verify did not report a verification"
  $second = Invoke-Installer @()
  Assert-True ($second.Code -eq 0) "the idempotent install exited $($second.Code)"
  Assert-True ($second.Out -match "already installed") "the second install was not idempotent"
  $marker = Join-Path $globalDir "tawassul-runtime\VERSION"
  Assert-True (Test-Path -LiteralPath $marker) "the installer did not write the marker"
  $markerText = Get-Content -LiteralPath $marker -Raw
  $lowered = $markerText -replace '"version": "[^"]+"', '"version": "0.0.0-receipt"'
  Assert-True ($lowered -ne $markerText) "the marker version was not lowered"
  Set-Content -LiteralPath $marker -Value $lowered -NoNewline
  $upgraded = Invoke-Installer @()
  Assert-True ($upgraded.Code -eq 0) "the upgrade install exited $($upgraded.Code)"
  Assert-True ($upgraded.Out -match "installed ") "the upgrade install did not report an install"
  $upgradedVerify = Invoke-Installer @("--verify")
  Assert-True ($upgradedVerify.Code -eq 0) "verify after upgrade exited $($upgradedVerify.Code)"
  Assert-True ((Get-Content -LiteralPath $marker -Raw) -notmatch "0\.0\.0-receipt") "the upgrade did not rewrite the marker version"
  $plugin = Join-Path $globalDir "plugins\tawassul.js"
  Assert-True (Test-Path -LiteralPath $plugin) "install did not stage the bundle at $plugin"
  $removed = Invoke-Installer @("--uninstall", "--purge", "--yes")
  Assert-True ($removed.Code -eq 0) "purge exited $($removed.Code)"
  Assert-True (-not $removed.TimedOut) "purge timed out"
  Assert-True (-not (Test-Path -LiteralPath $plugin)) "the plugin survived the purge"
  Assert-KeyAcl (Join-Path $runner "tawassul")
  Assert-Guards $guards
  Assert-True ((Get-PurgeArchives) -eq $archivesBefore) "the cycle archived real state"
  Note "$label seconds=$([Math]::Round(((Get-Date) - $started).TotalSeconds, 1))"
}

$bunPath = Resolve-BunPath
Note "mode=$Mode bun=$bunPath runner=$runner"
$archivesBefore = Get-PurgeArchives
$guards = Plant-Guards
Note "guards planted=$($guards.Count) purge-archives-before=$archivesBefore"

try {
  switch ($Mode) {
    "cycle" {
      Invoke-CycleBody "cycle" $guards $archivesBefore
    }
    "pwsh7" {
      $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
      if (-not $pwsh) { throw "pwsh was not found; this mode requires PowerShell 7" }
      $started = Get-Date
      $result = Invoke-BoundedProcess $pwsh.Source @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath, "-Mode", "cycle", "-Bun", $bunPath) 600
      if ($result.Out) { Write-Host $result.Out; $lines.Add("  " + $result.Out) | Out-Null }
      if ($result.Err) { Write-Host $result.Err; $lines.Add("  " + $result.Err) | Out-Null }
      Assert-True ($result.Code -eq 0) "the cycle under pwsh exited $($result.Code)"
      Assert-True (-not $result.TimedOut) "the cycle under pwsh timed out"
      Assert-True ($result.Out -match "verdict=PASS") "the cycle under pwsh did not pass"
      Assert-Guards $guards
      Note "pwsh seconds=$([Math]::Round(((Get-Date) - $started).TotalSeconds, 1))"
    }
    "longpath" {
      Set-IsolatedHome $runner | Out-Null
      $long = $runner
      while ($long.Length -lt 268) { $long = $long + "\" + "segment0123456789" }
      $long = $long + "\opencode"
      Note "long path length=$($long.Length)"
      $env:TAWASSUL_GLOBAL_DIR = $long
      $installed = Invoke-Installer @()
      Assert-True ($installed.Code -eq 0) "install at $($long.Length) characters exited $($installed.Code)"
      Assert-True ($installed.Out -match "installed ") "install at a long path did not report an install"
      Assert-True ($installed.Out -match "restricted the key directory ACL") "install at a long path did not restrict the ACL"
      $verified = Invoke-Installer @("--verify")
      Assert-True ($verified.Code -eq 0) "verify at a long path exited $($verified.Code)"
      Assert-True ($verified.Out -match "verified ") "verify at a long path did not report a verification"
      $keyDir = "\\?\" + (Join-Path (Split-Path -Parent $long) "tawassul")
      $acl = Invoke-Native $icaclsExe @($keyDir)
      Assert-True ($acl.Code -eq 0) "icacls failed on the long key directory"
      Assert-True ($acl.Out -match "\(OI\)\(CI\)") "icacls did not show a protected ACL at the long path"
      $removed = Invoke-Installer @("--uninstall")
      Assert-True ($removed.Code -eq 0) "uninstall at a long path exited $($removed.Code)"
      Note "longpath ok length=$($long.Length)"
    }
    "ast" {
      $globalDir = Set-IsolatedHome $runner
      $installed = Invoke-Installer @()
      Assert-True ($installed.Code -eq 0) "install before the AST check exited $($installed.Code)"
      $runtime = Join-Path $globalDir "tawassul-runtime"
      $wasm = Join-Path $runtime "wasm"
      Assert-True (Test-Path -LiteralPath $wasm) "the installer did not stage the wasm directory"
      $assets = @(Get-ChildItem -LiteralPath $wasm -Recurse -File -Filter "*.wasm")
      Assert-True ($assets.Count -eq 4) "expected 4 wasm assets, found $($assets.Count)"
      $grammars = @($assets | Where-Object { $_.Name -match "tree-sitter-(typescript|tsx|javascript)" })
      Assert-True ($grammars.Count -eq 3) "expected 3 grammar assets, found $($grammars.Count)"
      $ast = Invoke-Native $bunPath @((Join-Path $scriptsRoot "check-ast-runtime.ts"), "--runtime", $runtime, "--repo", $repo)
      Assert-True ($ast.Code -eq 0) "the AST check exited $($ast.Code)"
      Assert-True ($ast.Out -match "ast: PASS") "the AST check did not print ast: PASS"
      Assert-True ($ast.Out -match "typescript=\d+ tsx=\d+ javascript=\d+") "the AST check did not parse all three languages"
      $plugin = Join-Path $globalDir "plugins\tawassul.js"
      Assert-True (Test-Path -LiteralPath $plugin) "the installer did not stage the plugin bundle"
      $bundleCheck = Invoke-Native $bunPath @((Join-Path $scriptsRoot "check-ast-bundle.ts"), "--plugin", $plugin)
      Assert-True ($bundleCheck.Code -eq 0) "the installed-bundle AST check exited $($bundleCheck.Code)"
      Assert-True ($bundleCheck.Out -match "ast-bundle: PASS") "the installed-bundle AST check did not print ast-bundle: PASS"
      Assert-True ($bundleCheck.Out -match "tools=\d+") "the installed-bundle AST check did not count the registered tools"
      $removed = Invoke-Installer @("--uninstall")
      Assert-True ($removed.Code -eq 0) "uninstall after the AST check exited $($removed.Code)"
      Note "ast wasm=$($assets.Count) grammars=$($grammars.Count)"
    }
  }
  Note "verdict=PASS"
  if ($Log) { $lines | Set-Content -LiteralPath $Log -Encoding UTF8 }
} catch {
  Note "verdict=FAIL: $($_.Exception.Message)"
  if ($Log) { $lines | Set-Content -LiteralPath $Log -Encoding UTF8 }
  exit 1
} finally {
  foreach ($file in $guards) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $runner -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $runner) {
    try { [System.IO.Directory]::Delete("\\?\" + $runner, $true) } catch { }
  }
}
