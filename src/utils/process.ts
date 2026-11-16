
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    
    
    
    if (code === "ESRCH") return false;
    if (code === "ERR_UNKNOWN_SIGNAL" && process.platform === "win32") return false;
    
    return true;
  }
}
