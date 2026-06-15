import type { BrowserWindow } from 'electron'
import { log } from './logger'

let enabled = false
let mainWindow: BrowserWindow | null = null
const timers = new Map<string, number>()

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

function emit(prefix: string, message: string): void {
  const formatted = `[${prefix}] ${message}`
  console.log(formatted)
  log.debug(formatted)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('debug:log', {
      prefix,
      message: formatted,
      timestamp: Date.now(),
    })
  }
}

export function initDebugMode(win: BrowserWindow): void {
  mainWindow = win
}

export function isDebugEnabled(): boolean {
  return enabled
}

export function setDebugEnabled(nextEnabled: boolean): boolean {
  enabled = nextEnabled
  log.transports.file.level = nextEnabled ? 'debug' : 'warn'
  return enabled
}

export function debugLog(prefix: string, ...args: unknown[]): void {
  if (!enabled) return
  emit(prefix, args.map(formatArg).join(' '))
}

export function debugTime(label: string): void {
  if (!enabled) return
  timers.set(label, Date.now())
  emit('timer', `${label} started`)
}

export function debugTimeEnd(label: string): void {
  if (!enabled) return
  const startedAt = timers.get(label)
  timers.delete(label)
  if (startedAt == null) {
    emit('timer', `${label} ended`)
    return
  }
  emit('timer', `${label} completed in ${Date.now() - startedAt}ms`)
}
