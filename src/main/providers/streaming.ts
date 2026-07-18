import https from 'https'
import http from 'http'
import type { IncomingMessage } from 'http'
import { activeStreamingRequests, incrementFallbackCounter } from '../provider-stream-state'

export interface StreamFinish {
  resolve: (content: string) => void
  reject: (err: Error) => void
}

/**
 * Shared scaffold for streaming provider HTTP requests. Owns the pieces every
 * provider copy-pasted: the abortable-request registration keyed by conversation
 * (with a fallback counter for keyless calls), cleanup on every exit path,
 * request error wiring, and body write/end. The provider supplies only the
 * response handler; `finish.resolve/reject` already include cleanup.
 */
export function runStreamingRequest(
  conversationId: string,
  url: string,
  headers: Record<string, string | number>,
  body: string,
  handleResponse: (res: IncomingMessage, finish: StreamFinish) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestId = conversationId || `__provider_request__:${incrementFallbackCounter()}`
    const cleanupActiveRequest = (req: http.ClientRequest) => {
      if (activeStreamingRequests.get(requestId) === req) {
        activeStreamingRequests.delete(requestId)
      }
    }
    const urlObj = new URL(url)
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        handleResponse(res, {
          resolve: (content) => { cleanupActiveRequest(req); resolve(content) },
          reject: (err) => { cleanupActiveRequest(req); reject(err) },
        })
      },
    )
    req.on('error', (err) => { cleanupActiveRequest(req); reject(err) })
    activeStreamingRequests.set(requestId, req)
    req.write(body)
    req.end()
  })
}

/** Collects an error response body, then rejects with the provider-labeled error. */
export function rejectHttpError(
  res: IncomingMessage,
  finish: StreamFinish,
  toError: (body: string) => Error,
): void {
  let errBody = ''
  res.on('data', (chunk: Buffer) => { errBody += chunk.toString() })
  res.on('end', () => finish.reject(toError(errBody)))
}
