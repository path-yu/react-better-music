import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const LOCK_NAME = 'instance.lock'

function readInstancePid(lockFile: string) {
  try {
    const pid = Number(readFileSync(lockFile, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : 0
  } catch {
    return 0
  }
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Take an exclusive PID lock inside the app data directory. A stale lock left
 * by a crashed instance is detected by probing the recorded PID.
 */
export function acquireInstanceLock(appDataDir: string) {
  const lockFile = join(appDataDir, LOCK_NAME)
  mkdirSync(appDataDir, { recursive: true })

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const fd = openSync(lockFile, 'wx')
      try {
        writeFileSync(fd, String(process.pid), 'utf8')
      } finally {
        closeSync(fd)
      }
      return true
    } catch {
      const pid = readInstancePid(lockFile)
      if (pid && pid !== process.pid && isProcessAlive(pid)) return false
      // Stale lock (crash or PID reuse): remove it and try again.
      try {
        unlinkSync(lockFile)
      } catch {
        // ignore
      }
    }
  }

  return false
}

export function releaseInstanceLock(appDataDir: string) {
  const lockFile = join(appDataDir, LOCK_NAME)
  if (readInstancePid(lockFile) !== process.pid) return
  try {
    unlinkSync(lockFile)
  } catch {
    // ignore
  }
}
