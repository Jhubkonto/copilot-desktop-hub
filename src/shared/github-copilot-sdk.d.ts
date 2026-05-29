declare module '@github/copilot-sdk' {
  export interface SessionEvent {
    type:
      | 'assistant.message_delta'
      | 'assistant.message'
      | 'assistant.turn_end'
      | 'session.error'
    data: {
      deltaContent?: string
      content?: string
      message?: string
    }
  }

  export type PermissionRequestHandler = (...args: unknown[]) => unknown

  export const approveAll: PermissionRequestHandler

  export class CopilotSession {
    sessionId: string
    on(listener: (event: SessionEvent) => void): () => void
    send(payload: { prompt: string }): Promise<void>
    disconnect(): Promise<void>
  }

  export class CopilotClient {
    start(): Promise<void>
    stop(): Promise<void>
    getState(): string
    createSession(options: {
      onPermissionRequest: PermissionRequestHandler
    }): Promise<CopilotSession>
    resumeSession(
      sessionId: string,
      options: { onPermissionRequest: PermissionRequestHandler },
    ): Promise<CopilotSession>
  }
}
