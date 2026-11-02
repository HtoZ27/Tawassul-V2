param(
  [ValidateSet("cycle", "pwsh7", "longpath", "ast")]
  [string]$Mode = "cycle",
  [string]$Bun = "",
  [string]$Log = ""
)

$ErrorActionPreference = "Stop"
$scriptsRoot = $PSScriptRoot
$repo = Split-Path -Parent $scriptsRoot
$wrapper = Join-Path $scriptsRoot "windows-install.cmd"
$ladder = Join-Path $scriptsRoot "windows-install.ps1"
$installer = Join-Path $scriptsRoot "install-global.ts"
$cmdExe = Join-Path $env:SystemRoot "System32\cmd.exe"
$powershellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$icaclsExe = Join-Path $env:SystemRoot "System32\icacls.exe"
$script:cmdCalls = 0
$runner = Join-Path ([System.IO.Path]::GetTempPath()) ("tawassul-ci-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$guardId = [guid]::NewGuid().ToString("N").Substring(0, 8)
$lines = New-Object System.Collections.Generic.List[string]
$bunPath = $Bun

New-Item -ItemType Directory -Force -Path $runner | Out-Null

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

function Invoke-Cycle([string]$launcher) {
  $globalDir = Join-Path $runner "opencode"
  $started = Get-Date
  if ($launcher -eq "cmd") {
    $script:cmdCalls = $script:cmdCalls + 1
    $commandLine = "`"$wrapper`" -Action cycle -GlobalDir `"$globalDir`" -Bun `"$bunPath`""
    $result = Invoke-Native $cmdExe @("/c", $commandLine)
  } else {
    $result = Invoke-Native $launcher @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $ladder, "-Action", "cycle", "-GlobalDir", $globalDir, "-Bun", $bunPath)
  }
  return @{
    Code = $result.Code
    Seconds = [Math]::Round(((Get-Date) - $started).TotalSeconds, 1)
    Out = $result.Out
    GlobalDir = $globalDir
  }
}

function Invoke-CycleShim {
  if (-not (Test-Path -LiteralPath $cmdExe) -or -not (Test-Path -LiteralPath $wrapper)) {
    Note "cmd-shim=skipped (cmd.exe or windows-install.cmd absent)"
    return $null
  }
  Note "cmd-shim=probe"
  return Invoke-Cycle "cmd"
}

function Assert-CmdFree {
  Assert-True ($script:cmdCalls -eq 0) "the primary lane invoked cmd.exe $($script:cmdCalls) times"
  Note "cmd-free: PASS"
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
    New-Item -ItemType Directory -Force -Path $base | Out-Null
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

function Invoke-Installer([string[]]$arguments) {
  return Invoke-Native $bunPath (@($installer) + $arguments)
}

$bunPath = Resolve-BunPath
Note "mode=$Mode bun=$bunPath runner=$runner"
$archivesBefore = Get-PurgeArchives
$guards = Plant-Guards
Note "guards planted=$($guards.Count) purge-archives-before=$archivesBefore"

try {
  switch ($Mode) {
    "cycle" {
      $result = Invoke-Cycle $powershellExe
      Assert-True ($result.Code -eq 0) "the ladder exited $($result.Code)"
      Assert-True ($result.Out -match "PASS \(cycle\)") "the ladder did not print PASS (cycle)"
      Assert-True ($result.Out -match "state isolated at:") "the cycle did not isolate state"
      Assert-True ($result.Out -match "install-global install exit=0") "install did not report exit 0"
      Assert-True ($result.Out -match "install-global --verify exit=0") "verify did not report exit 0"
      Assert-True ($result.Out -match "--uninstall --purge --yes exit=0") "purge did not report exit 0"
      Assert-True ($result.Out -match "removed the isolated state at:") "the cycle did not remove its isolated state"
      $tempRoot = (($result.Out -split "state isolated at: ")[1] -split "`n")[0].Trim()
      Assert-True (-not (Test-Path -LiteralPath $tempRoot)) "the isolated state $tempRoot survived the cycle"
      Assert-True (-not (Test-Path -LiteralPath (Join-Path $result.GlobalDir "plugins\tawassul.js"))) "the plugin survived the purge"
      Assert-Guards $guards
      Assert-True ((Get-PurgeArchives) -eq $archivesBefore) "the cycle archived real state"
      Assert-KeyAcl (Join-Path (Split-Path -Parent $result.GlobalDir) "tawassul")
      Note "cycle seconds=$($result.Seconds)"
      Assert-CmdFree
      $shim = Invoke-CycleShim
      if ($shim) {
        Assert-True ($shim.Code -eq 0) "the cmd shim exited $($shim.Code)"
        Assert-True ($shim.Out -match "PASS \(cycle\)") "the cmd shim did not print PASS (cycle)"
        Note "cmd-shim seconds=$($shim.Seconds)"
      }
    }
    "pwsh7" {
      $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
      if (-not $pwsh) { throw "pwsh was not found; this mode requires PowerShell 7" }
      $result = Invoke-Cycle $pwsh.Source
      Assert-True ($result.Code -eq 0) "the ladder exited $($result.Code) under pwsh"
      Assert-True ($result.Out -match "PASS \(cycle\)") "the ladder did not print PASS (cycle) under pwsh"
      Assert-True ($result.Out -match "state isolated at:") "the cycle did not isolate state under pwsh"
      Assert-Guards $guards
      Assert-True ((Get-PurgeArchives) -eq $archivesBefore) "the cycle archived real state under pwsh"
      Assert-CmdFree
      Note "pwsh seconds=$($result.Seconds)"
    }
    "longpath" {
      $long = $runner
      while ($long.Length -lt 268) { $long = $long + "\" + "segment0123456789" }
      $long = $long + "\opencode"
      Note "long path length=$($long.Length)"
      $stateRoot = Join-Path $runner "home"
      $env:TAWASSUL_GLOBAL_DIR = $long
      $env:HOME = $stateRoot
      $env:XDG_CONFIG_HOME = Join-Path $stateRoot ".config"
      $env:XDG_DATA_HOME = Join-Path $stateRoot ".local\share"
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
      Assert-CmdFree
      Note "longpath ok length=$($long.Length)"
    }
    "ast" {
      $globalDir = Join-Path $runner "opencode"
      $stateRoot = Join-Path $runner "home"
      $env:TAWASSUL_GLOBAL_DIR = $globalDir
      $env:HOME = $stateRoot
      $env:XDG_CONFIG_HOME = Join-Path $stateRoot ".config"
      $env:XDG_DATA_HOME = Join-Path $stateRoot ".local\share"
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
      Assert-CmdFree
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
