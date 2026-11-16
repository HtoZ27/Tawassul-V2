function Quote-ProcessArgument([string]$value) {
  if ($value -match '[\s"]') { return '"' + ($value -replace '"', '\"') + '"' }
  return $value
}

function Invoke-BoundedProcess([string]$file, [string[]]$arguments, [int]$seconds) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $file
  $info.Arguments = (@($arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join " ")
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.CreateNoWindow = $true
  $started = Get-Date
  $process = [System.Diagnostics.Process]::Start($info)
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  $timedOut = -not $process.WaitForExit($seconds * 1000)
  if ($timedOut) {
    try { $process.Kill() } catch { }
    try { $process.WaitForExit(10000) | Out-Null } catch { }
  } else {
    $process.WaitForExit()
  }
  $out = ""
  $err = ""
  try { if ($stdout.Wait(5000)) { $out = $stdout.Result } } catch { }
  try { if ($stderr.Wait(5000)) { $err = $stderr.Result } } catch { }
  $code = -1
  if (-not $timedOut) { try { $code = $process.ExitCode } catch { } }
  return @{
    Code = $code
    TimedOut = $timedOut
    Out = $out
    Err = $err
    Seconds = [Math]::Round(((Get-Date) - $started).TotalSeconds, 1)
  }
}
