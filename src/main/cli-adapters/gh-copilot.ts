import { spawnSync } from 'child_process'
import type { BrowserWindow } from 'electron'
import type { CliAgentAdapter, CliAdapterRequest } from './types'
import { resolveCliPath } from './utils'

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

function getLastUserMessage(req: CliAdapterRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const msg = req.messages[i]
    if (msg.role === 'user') {
      return typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    }
  }
  return ''
}

export const GhCopilotAdapter: CliAgentAdapter = {
  name: 'gh-copilot',

  isAvailable(): boolean {
    return resolveCliPath('gh') !== null
  },

  send(
    _window: BrowserWindow,
    req: CliAdapterRequest,
    onChunk: (chunk: string) => void,
    _onEvent?: Parameters<CliAgentAdapter['send']>[3]
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const ghPath = resolveCliPath('gh')
        if (!ghPath) {
          reject(new Error('gh CLI not found'))
          return
        }
        const message = getLastUserMessage(req)
        const result = spawnSync(ghPath, ['copilot', 'suggest', '-t', 'shell', message], {
          cwd: req.cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
          timeout: 30000,
        })
        if (result.error) {
          reject(result.error)
          return
        }
        const output = stripAnsi(result.stdout ?? '')
        onChunk(output)
        resolve(output)
      } catch (err) {
        reject(err)
      }
    })
  },
}
