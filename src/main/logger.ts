import log from 'electron-log/main'
import { recordErrorLogEntry } from './error-log-handlers'

export function initLogger(): void {
  log.initialize()
  log.transports.file.level = 'warn'

  process.on('uncaughtException', (err) => {
    log.error('uncaughtException', err)
    recordErrorLogEntry({
      source: 'unhandled',
      level: 'error',
      message: err.message,
      stack: err.stack ?? null,
    })
  })
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', reason)
    const error = reason instanceof Error ? reason : null
    recordErrorLogEntry({
      source: 'unhandled',
      level: 'error',
      message: error ? error.message : String(reason),
      stack: error?.stack ?? null,
    })
  })
}

export { log }
