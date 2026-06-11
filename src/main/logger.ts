import log from 'electron-log/main'

export function initLogger(): void {
  log.initialize()
  log.transports.file.level = 'warn'

  process.on('uncaughtException', (err) => {
    log.error('uncaughtException', err)
  })
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', reason)
  })
}

export { log }
