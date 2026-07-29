#!/usr/bin/env node
// Runs electron-builder once per architecture instead of one multi-arch
// invocation. electron-builder has a known race when packaging x64 and
// arm64 for the same platform in a single run (they share electron.exe
// staging) — one arch's `rename electron.exe -> Nexy.exe` can fail with
// ENOENT while electron-builder logs the error and keeps signing/packaging
// the other arch anyway, producing a "successful" run with a broken
// installer. Building sequentially avoids the race, and checking the exit
// code after each step means a failed arch actually stops the build.
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ARCHS_BY_PLATFORM = {
  win: ['x64', 'arm64'],
  mac: ['x64', 'arm64'],
  linux: ['x64'],
}

const PLATFORM_FLAG = { win: '--win', mac: '--mac', linux: '--linux' }

function currentPlatform() {
  if (process.platform === 'win32') return 'win'
  if (process.platform === 'darwin') return 'mac'
  return 'linux'
}

const platform = process.argv[2] || currentPlatform()
const archs = ARCHS_BY_PLATFORM[platform]
if (!archs) {
  console.error(`Unknown platform "${platform}"`)
  process.exit(1)
}

const lockDir = path.join(process.cwd(), 'node_modules', '.cache')
const lockPath = path.join(lockDir, 'nexy-package.lock')
mkdirSync(lockDir, { recursive: true })

let lockFd
function acquireLock() {
  try {
    lockFd = openSync(lockPath, 'wx')
    writeFileSync(lockFd, `${process.pid}\n`, 'utf8')
    return
  } catch {
    let ownerPid
    try {
      ownerPid = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10)
    } catch {
      // An unreadable lock is treated as active to avoid overlapping builds.
    }

    if (Number.isFinite(ownerPid)) {
      try {
        process.kill(ownerPid, 0)
      } catch {
        // A force-killed build cannot run its exit cleanup. Remove its stale
        // lock and acquire a fresh one.
        try { unlinkSync(lockPath) } catch {}
        lockFd = openSync(lockPath, 'wx')
        writeFileSync(lockFd, `${process.pid}\n`, 'utf8')
        return
      }
    }

    const owner = Number.isFinite(ownerPid) ? `process ${ownerPid}` : 'another process'
    console.error(`\nPackaging is already running in ${owner}. Cancel that build and wait for it to stop before retrying.`)
    process.exit(1)
  }
}

acquireLock()

let activeChild
let shuttingDown = false

function cleanupLock() {
  if (lockFd !== undefined) {
    try { closeSync(lockFd) } catch {}
    lockFd = undefined
  }
  try { unlinkSync(lockPath) } catch {}
}

function stopActiveChild(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.error(`\nPackaging received ${signal}; stopping electron-builder…`)
  activeChild?.kill(signal)
  cleanupLock()
  process.exitCode = signal === 'SIGINT' ? 130 : 143
}

process.on('SIGINT', () => stopActiveChild('SIGINT'))
process.on('SIGTERM', () => stopActiveChild('SIGTERM'))
process.on('exit', cleanupLock)

const builderCli = path.join(process.cwd(), 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')

for (const arch of archs) {
  console.log(`\n> electron-builder ${PLATFORM_FLAG[platform]} --${arch}`)
  activeChild = spawn(process.execPath, [builderCli, PLATFORM_FLAG[platform], `--${arch}`], {
    stdio: 'inherit',
  })

  const startedAt = Date.now()
  const heartbeat = setInterval(() => {
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000)
    console.log(`  • still packaging ${platform}/${arch} (${elapsedSeconds}s elapsed)`)
  }, 30_000)

  const exitCode = await new Promise((resolve, reject) => {
    activeChild.once('error', reject)
    activeChild.once('close', (code, signal) => {
      if (signal) {
        resolve(signal === 'SIGINT' ? 130 : 143)
      } else {
        resolve(code ?? 1)
      }
    })
  }).finally(() => clearInterval(heartbeat))

  activeChild = undefined
  if (exitCode !== 0) {
    console.error(`\nelectron-builder failed for ${platform}/${arch} (exit ${exitCode}) — stopping.`)
    cleanupLock()
    process.exit(exitCode)
  }
}

cleanupLock()
