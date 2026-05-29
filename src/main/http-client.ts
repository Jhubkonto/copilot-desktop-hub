import https from 'https'
import type { RequestOptions } from 'https'
import type { IncomingMessage } from 'http'

export interface HttpsResponse {
  status: number
  headers: IncomingMessage['headers']
  data: string
}

function requestWithResponse(options: RequestOptions, body?: string): Promise<HttpsResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk.toString()
      })
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          data
        })
      })
      res.on('error', reject)
    })

    req.setTimeout(30000, () => {
      req.destroy(new Error('Request timed out'))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

/** General https request returning raw response body */
export async function httpsRequest(options: RequestOptions, body?: string): Promise<string> {
  return (await requestWithResponse(options, body)).data
}

export async function httpsRequestWithResponse(options: RequestOptions, body?: string): Promise<HttpsResponse> {
  return requestWithResponse(options, body)
}

/** Low-level POST returning raw response body */
export function httpsPost(url: string, headers: Record<string, string | number>, body: string): Promise<string> {
  const urlObj = new URL(url)
  return httpsRequest(
    {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body)
      }
    },
    body
  )
}

/** Low-level GET returning raw response body */
export function httpsGet(url: string, headers: Record<string, string | number>): Promise<string> {
  const urlObj = new URL(url)
  return httpsRequest({
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers
  })
}

/** Parse an SSE stream, calling onDelta for each non-empty delta string.
 *  Returns when the stream ends or [DONE] is received. */
export function parseSseStream(res: IncomingMessage, onDelta: (delta: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    let finished = false

    const cleanup = () => {
      res.off('data', handleData)
      res.off('end', handleEnd)
      res.off('error', handleError)
    }

    const finish = () => {
      if (finished) return
      finished = true
      cleanup()
      resolve()
    }

    const handleLine = (line: string) => {
      if (finished) return
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) return
      const data = trimmed.slice(5).trimStart()
      if (data === '[DONE]') {
        finish()
        return
      }
      if (data) onDelta(data)
    }

    const processBuffer = (flush = false) => {
      const lines = buffer.split('\n')
      const trailing = flush ? '' : (lines.pop() ?? '')
      for (const rawLine of lines) {
        handleLine(rawLine.replace(/\r$/, ''))
        if (finished) return
      }
      if (flush && trailing) {
        handleLine(trailing.replace(/\r$/, ''))
        if (finished) return
      }
      buffer = trailing
    }

    const handleData = (chunk: Buffer | string) => {
      buffer += chunk.toString()
      processBuffer(false)
    }

    const handleEnd = () => {
      processBuffer(true)
      finish()
    }

    const handleError = (error: Error) => {
      if (finished) return
      finished = true
      cleanup()
      reject(error)
    }

    res.on('data', handleData)
    res.on('end', handleEnd)
    res.on('error', handleError)
  })
}
