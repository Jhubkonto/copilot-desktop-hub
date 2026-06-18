import http from 'http'

export const activeStreamingRequests = new Map<string, http.ClientRequest>()
export const activeCliAbortControllers = new Map<string, AbortController>()
let fallbackStreamingRequestCounter = 0

export function incrementFallbackCounter(): number {
  return fallbackStreamingRequestCounter++
}

export function abortActiveStream(conversationId?: string): void {
  if (conversationId) {
    const req = activeStreamingRequests.get(conversationId)
    if (req) {
      req.destroy()
      activeStreamingRequests.delete(conversationId)
    }
    const ctrl = activeCliAbortControllers.get(conversationId)
    if (ctrl) {
      ctrl.abort()
      activeCliAbortControllers.delete(conversationId)
    }
    return
  }

  for (const req of activeStreamingRequests.values()) req.destroy()
  activeStreamingRequests.clear()
  for (const ctrl of activeCliAbortControllers.values()) ctrl.abort()
  activeCliAbortControllers.clear()
}
