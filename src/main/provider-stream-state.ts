import http from 'http'

export const activeStreamingRequests = new Map<string, http.ClientRequest>()
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
    return
  }

  for (const req of activeStreamingRequests.values()) req.destroy()
  activeStreamingRequests.clear()
}
