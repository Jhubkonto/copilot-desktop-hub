import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { broadcastToMobile } from './ws-server'
import type { BuildRecord, BuildStatus } from '../shared/types'

/**
 * Shared build-process runner used by both the desktop (`build-handlers.ts`)
 * and Android (`android-handlers.ts`) build orchestrators. Owns the spawn,
 * repeated-line log dedup, log-tail capping, streaming log events, the
 * close-time `build_records` UPDATE, and cancellation — all previously
 * copy-pasted between the two modules (and twice within build-handlers).
 */

// Retain the complete Gradle failure diagnostic block (source location,
// compiler error, task summary, and recovery guidance) in build history.
const MAX_LOG_CHARS = 256 * 1024

export function mapBuildRecord(row: Record<string, unknown>): BuildRecord {
  return {
    id: row.id as string,
    workspacePath: row.workspace_path as string,
    commitSha: (row.commit_sha as string | null) ?? null,
    branch: (row.branch as string | null) ?? null,
    version: (row.version as string | null) ?? null,
    versionCode: (row.version_code as number | null) ?? null,
    platform: row.platform as string,
    command: row.command as BuildRecord['command'],
    status: row.status as BuildStatus,
    exitCode: (row.exit_code as number | null) ?? null,
    artifactPaths: JSON.parse((row.artifact_paths as string | null) ?? '[]') as string[],
    artifactChecksums: JSON.parse((row.artifact_checksums as string | null) ?? '{}') as Record<string, string>,
    logTail: (row.log_tail as string | null) ?? '',
    startedAt: row.started_at as number,
    finishedAt: (row.finished_at as number | null) ?? null,
    mobileInitiated: Boolean(row.mobile_initiated),
  }
}

export interface RunBuildProcessOptions {
  db: Database.Database
  buildId: string
  spawnCmd: string
  spawnArgs: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  /** e.g. 'build:log-chunk' / 'android:log-chunk' */
  logEvent: string
  /** e.g. 'build:command-done' / 'android:command-done' */
  doneEvent: string
  window?: BrowserWindow
  /** Also broadcast log/done events to the Android companion. */
  mirrorToMobile?: boolean
  registry: Map<string, ChildProcess>
  /** Optional artifact collection run on close before the DB update. */
  collectArtifacts?: () => Promise<{ artifactPaths: string[]; artifactChecksums?: Record<string, string> }>
  /** Extra work after the DB update + done event (e.g. auto-publish, endActivity). */
  onDone?: (status: BuildStatus, exitCode: number) => void
}

export function runBuildProcess(options: RunBuildProcessOptions): ChildProcess {
  const {
    db, buildId, spawnCmd, spawnArgs, cwd, env,
    logEvent, doneEvent, window: win, mirrorToMobile = false,
    registry, collectArtifacts, onDone,
  } = options

  const emit = (event: string, data: unknown): void => {
    win?.webContents.send(event, data)
    if (mirrorToMobile) broadcastToMobile({ event, data })
  }

  const child = spawn(spawnCmd, spawnArgs, { shell: true, cwd, env })
  registry.set(buildId, child)

  const logLines: string[] = []
  let lastUniqueLine = ''
  let repeatCount = 0

  function appendLog(line: string, stream: 'stdout' | 'stderr'): void {
    if (line === lastUniqueLine) {
      repeatCount++
      const summary = `  [repeated ${repeatCount + 1}×]`
      // Keep the original compiler line; replacing it hides repeated errors.
      logLines.push(summary)
      emit(logEvent, { buildId, line: summary, stream })
      return
    }
    lastUniqueLine = line
    repeatCount = 0
    logLines.push(line)
    emit(logEvent, { buildId, line, stream })
  }

  function buildLogTail(): string {
    const joined = logLines.join('\n')
    return joined.length > MAX_LOG_CHARS ? joined.slice(-MAX_LOG_CHARS) : joined
  }

  child.stdout?.on('data', (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      if (line) appendLog(line, 'stdout')
    }
  })

  child.stderr?.on('data', (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      if (line) appendLog(line, 'stderr')
    }
  })

  // Returns the async work's promise so callers (and tests) awaiting the close
  // handler observe the DB update and done event.
  child.on('close', (code) => {
    return (async () => {
      registry.delete(buildId)
      const exitCode = code ?? -1
      const status: BuildStatus = exitCode === 0 ? 'success' : 'failed'
      const finishedAt = Date.now()
      const logTail = buildLogTail()
      const { artifactPaths, artifactChecksums } = collectArtifacts
        ? await collectArtifacts()
        : { artifactPaths: [] as string[], artifactChecksums: undefined }

      if (artifactChecksums) {
        db.prepare(
          `UPDATE build_records
           SET status = ?, exit_code = ?, finished_at = ?, log_tail = ?, artifact_paths = ?, artifact_checksums = ?
           WHERE id = ?`
        ).run(status, exitCode, finishedAt, logTail, JSON.stringify(artifactPaths), JSON.stringify(artifactChecksums), buildId)
      } else {
        db.prepare(
          `UPDATE build_records
           SET status = ?, exit_code = ?, finished_at = ?, log_tail = ?, artifact_paths = ?
           WHERE id = ?`
        ).run(status, exitCode, finishedAt, logTail, JSON.stringify(artifactPaths), buildId)
      }

      emit(doneEvent, { buildId, status, exitCode })
      onDone?.(status, exitCode)
    })()
  })

  return child
}

export interface CancelBuildProcessOptions {
  db: Database.Database
  buildId: string
  registry: Map<string, ChildProcess>
  /** When set, a cancelled done-event is broadcast to the Android companion. */
  mobileDoneEvent?: string
  /** Extra cleanup (e.g. endActivity). */
  onCancelled?: () => void
}

export function cancelBuildProcess(options: CancelBuildProcessOptions): boolean {
  const { db, buildId, registry, mobileDoneEvent, onCancelled } = options
  const child = registry.get(buildId)
  if (!child) return false
  child.kill('SIGTERM')
  registry.delete(buildId)
  onCancelled?.()
  db.prepare(`UPDATE build_records SET status = 'cancelled', finished_at = ? WHERE id = ?`).run(Date.now(), buildId)
  if (mobileDoneEvent) {
    broadcastToMobile({ event: mobileDoneEvent, data: { buildId, status: 'cancelled', exitCode: null } })
  }
  return true
}
