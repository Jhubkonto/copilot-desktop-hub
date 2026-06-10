import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { startFeedServer, stopFeedServer, getFeedUrl, isFeedRunning } from '../local-feed-server'

describe('local-feed-server', () => {
  afterEach(() => {
    stopFeedServer()
  })

  it('starts on a random port and reports running', async () => {
    const dir = path.join(tmpdir(), `nexy-feed-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      const port = await startFeedServer(dir)
      expect(port).toBeGreaterThan(0)
      expect(isFeedRunning()).toBe(true)
      expect(getFeedUrl()).toBe(`http://127.0.0.1:${port}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('serves a file with correct content', async () => {
    const dir = path.join(tmpdir(), `nexy-feed-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'latest.yml'), 'version: 0.9.0\n')
    try {
      await startFeedServer(dir)
      const resp = await fetch(`${getFeedUrl()}/latest.yml`)
      expect(resp.status).toBe(200)
      const text = await resp.text()
      expect(text).toContain('version: 0.9.0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns 404 for a missing file', async () => {
    const dir = path.join(tmpdir(), `nexy-feed-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      await startFeedServer(dir)
      const resp = await fetch(`${getFeedUrl()}/does-not-exist.yml`)
      expect(resp.status).toBe(404)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects path traversal attempts with 404', async () => {
    const dir = path.join(tmpdir(), `nexy-feed-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      await startFeedServer(dir)
      const resp = await fetch(`${getFeedUrl()}/../etc/passwd`)
      expect(resp.status).toBe(404)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stops cleanly and clears state', async () => {
    const dir = path.join(tmpdir(), `nexy-feed-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      await startFeedServer(dir)
      expect(isFeedRunning()).toBe(true)
      stopFeedServer()
      expect(isFeedRunning()).toBe(false)
      expect(getFeedUrl()).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
