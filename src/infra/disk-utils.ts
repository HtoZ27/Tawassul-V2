import { statfs, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

export const MIN_DISK_SPACE_BYTES = 1 * 1024 * 1024;


export async function atomicWriteFile(fp: string, content: string): Promise<void> {
  const rnd = randomBytes(6).toString("hex");
  const tmp = `${fp}.${process.pid}-${rnd}.tmp`;
  let fh;
  try {
    fh = await open(tmp, "w", 0o600);
    await fh.writeFile(content, "utf-8");
    await fh.sync();
  } catch (e) {
    try {
      await unlink(tmp);
    } catch {
      
    }
    throw e;
  } finally {
    if (fh) await fh.close();
  }
  try {
    await rename(tmp, fp);
  } catch (e) {
    
    
    
    
    const err = e as NodeJS.ErrnoException;
    if (process.platform === "win32" && err?.code === "EPERM") {
      try {
        await unlink(fp);
        await rename(tmp, fp);
      } catch {
        try {
          await unlink(tmp);
        } catch {
          
        }
        throw e;
      }
    } else {
      try {
        await unlink(tmp);
      } catch {
        
      }
      throw e;
    }
  }
  try {
    const dh = await open(dirname(fp), "r");
    try {
      await dh.sync();
    } catch {
      
    } finally {
      await dh.close();
    }
  } catch {

  }
}


export async function atomicWriteFileFast(fp: string, content: string): Promise<void> {
  const rnd = randomBytes(6).toString("hex");
  const tmp = `${fp}.${process.pid}-${rnd}.tmp`;
  let fh;
  try {
    fh = await open(tmp, "w", 0o600);
    await fh.writeFile(content, "utf-8");
  } catch (e) {
    try {
      await unlink(tmp);
    } catch {
      
    }
    throw e;
  } finally {
    if (fh) await fh.close();
  }
  try {
    await rename(tmp, fp);
  } catch (e) {
    
    
    
    
    
    const err = e as NodeJS.ErrnoException;
    if (process.platform === "win32" && err?.code === "EPERM") {
      try {
        await unlink(fp);
        await rename(tmp, fp);
        return;
      } catch {
        
      }
    }
    try {
      await unlink(tmp);
    } catch {
      
    }
    throw e;
  }
}

export async function checkDiskSpace(filePath: string): Promise<{ ok: true } | { ok: false; error: string }> {
  
  
  
  if (process.platform === "win32") {
    return { ok: true };
  }
  try {
    const s = await statfs(dirname(filePath));
    if (s.bsize * s.bavail < MIN_DISK_SPACE_BYTES) {
      return {
        ok: false,
        error: `Low disk space: ${Math.round((s.bsize * s.bavail) / 1024)}KB available, need ${Math.round(MIN_DISK_SPACE_BYTES / 1024)}KB`,
      };
    }
    return { ok: true };
  } catch {
    
    return { ok: true };
  }
}
