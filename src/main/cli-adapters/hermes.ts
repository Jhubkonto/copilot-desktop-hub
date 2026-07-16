import { spawnSync } from 'child_process'
import type { BrowserWindow } from 'electron'
import type { CliAgentAdapter, CliAdapterRequest } from './types'
import { resolveCliPath } from './utils'
import { debugLog } from '../debug-mode'

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

function buildPrompt(req: CliAdapterRequest): string {
  const lastMsg = req.messages[req.messages.length - 1]
  const prompt = typeof lastMsg?.content === 'string'
    ? lastMsg.content
    : JSON.stringify(lastMsg?.content ?? '')

  // No native system-prompt flag; embed it as a text prefix, same workaround codex.ts uses.
  return req.systemPrompt ? `[System]: ${req.systemPrompt}\n\n${prompt}` : prompt
}

export const HermesAdapter: CliAgentAdapter = {
  name: 'hermes-cli',

  isAvailable(): boolean {
    return resolveCliPath('hermes') !== null
  },

  send(
    _window: BrowserWindow,
    req: CliAdapterRequest,
    onChunk: (chunk: string) => void,
    _onEvent?: Parameters<CliAgentAdapter['send']>[3]
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const hermesPath = resolveCliPath('hermes')
        if (!hermesPath) {
          reject(new Error('hermes CLI not found'))
          return
        }
        // -z: single prompt in, final response text out, nothing else on stdout/stderr.
        // --ignore-user-config/--ignore-rules keep the run isolated from the host's local
        // Hermes config/memory/skills so behavior is reproducible from Nexy. `-Q`/`--source`
        // are NOT real flags on this CLI (confirmed against its own usage banner) — do not
        // reintroduce them without verifying against `hermes -h` first.
        const args = ['-z', buildPrompt(req), '--ignore-user-config', '--ignore-rules']
        if (req.model && req.model !== 'default') {
          args.push('-m', req.model)
        }
        debugLog('cli', `hermes spawn: ${hermesPath} ${args.slice(0, 1).join(' ')} <prompt> ${args.slice(2).join(' ')}`)
        const result = spawnSync(hermesPath, args, {
          cwd: req.cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
          timeout: 120000,
        })
        if (result.error) {
          reject(result.error)
          return
        }
        const stderr = stripAnsi(result.stderr ?? '').trim()
        const output = stripAnsi(result.stdout ?? '').trim()
        debugLog('cli', `hermes exit: status=${result.status ?? 'null'} signal=${result.signal ?? 'null'} stdoutLen=${output.length} stderrLen=${stderr.length}`)
        if (result.status !== 0) {
          reject(new Error(stderr || `hermes exited with status ${result.status ?? result.signal ?? 'unknown'}`))
          return
        }
        if (!output && stderr) {
          reject(new Error(stderr))
          return
        }
        onChunk(output)
        resolve(output)
      } catch (err) {
        reject(err)
      }
    })
  },
}
