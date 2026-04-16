import { CopilotClient, CopilotSession, approveAll } from '@github/copilot-sdk'
import type { SessionEvent } from '@github/copilot-sdk'
import { BrowserWindow } from 'electron'

let client: CopilotClient | null = null
let activeSession: CopilotSession | null = null

export async function getCopilotClient(): Promise<CopilotClient> {
  if (client && client.getState() === 'connected') {
    return client
  }

  client = new CopilotClient()
  await client.start()
  return client
}

export async function sendCopilotMessage(
  window: BrowserWindow,
  conversationId: string,
  content: string,
  sessionId?: string
): Promise<{ responseContent: string; copilotSessionId: string }> {
  const copilotClient = await getCopilotClient()

  // Create or resume a session
  let session: CopilotSession
  if (sessionId) {
    try {
      session = await copilotClient.resumeSession(sessionId, {
        onPermissionRequest: approveAll
      })
    } catch {
      // Session may have been deleted; create a new one
      session = await copilotClient.createSession({
        onPermissionRequest: approveAll
      })
    }
  } else {
    session = await copilotClient.createSession({
      onPermissionRequest: approveAll
    })
  }

  activeSession = session

  let responseContent = ''

  return new Promise((resolve, reject) => {
    const unsubscribe = session.on((event: SessionEvent) => {
      switch (event.type) {
        case 'assistant.message_delta':
          // Stream deltas to the renderer
          window.webContents.send('chat:stream-response', event.data.deltaContent)
          responseContent += event.data.deltaContent
          break

        case 'assistant.message':
          // Final message — use it as the canonical content
          if (event.data.content) {
            responseContent = event.data.content
          }
          break

        case 'assistant.turn_end':
          // Signal end of stream
          window.webContents.send('chat:stream-response', null)
          unsubscribe()
          resolve({
            responseContent,
            copilotSessionId: session.sessionId
          })
          break

        case 'session.error':
          window.webContents.send('chat:stream-response', null)
          unsubscribe()
          reject(new Error(event.data.message || 'Copilot session error'))
          break
      }
    })

    session.send({ prompt: content }).catch((err) => {
      window.webContents.send('chat:stream-response', null)
      unsubscribe()
      reject(err)
    })
  })
}

export async function stopGeneration(): Promise<void> {
  if (activeSession) {
    await activeSession.disconnect()
    activeSession = null
  }
}

export async function shutdownCopilot(): Promise<void> {
  if (activeSession) {
    await activeSession.disconnect()
    activeSession = null
  }
  if (client) {
    await client.stop()
    client = null
  }
}
