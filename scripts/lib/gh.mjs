import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * WinGet installs GitHub CLI under Program Files, but the PATH inherited by an
 * already-open terminal (or by pnpm) may not contain it yet. Resolve gh from
 * the common install locations before giving up.
 */
export function findGh() {
  const candidates = [
    process.env.GH_PATH,
    'gh',
    join(
      process.env.ProgramFiles ?? 'C:\\Program Files',
      'GitHub CLI',
      'gh.exe',
    ),
    join(
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      'GitHub CLI',
      'gh.exe',
    ),
    join(
      process.env.LOCALAPPDATA ?? '',
      'GitHubCLI',
      'bin',
      'gh.exe',
    ),
    join(
      process.env.LOCALAPPDATA ?? '',
      'Programs',
      'GitHub CLI',
      'gh.exe',
    ),
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (candidate !== 'gh' && !existsSync(candidate)) {
      continue
    }
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' })
      return candidate
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

export function runGh(executable, args, options = {}) {
  return execFileSync(executable, args, {
    stdio: 'inherit',
    ...options,
  })
}
