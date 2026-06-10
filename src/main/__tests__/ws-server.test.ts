import { describe, expect, it } from 'vitest'
import { normalizeExternalWssUrl } from '../ws-server'

describe('ws server pairing urls', () => {
  it('adds the active token to a secure external websocket url', () => {
    expect(normalizeExternalWssUrl('wss://nexy.example/mobile', 'token-123')).toBe(
      'wss://nexy.example/mobile?token=token-123',
    )
  })

  it('replaces a stale token on the secure external websocket url', () => {
    expect(normalizeExternalWssUrl('wss://nexy.example/mobile?token=old&foo=bar', 'new')).toBe(
      'wss://nexy.example/mobile?token=new&foo=bar',
    )
  })

  it('rejects plain websocket external urls for secure pairing', () => {
    expect(normalizeExternalWssUrl('ws://nexy.example/mobile', 'token-123')).toBeNull()
  })
})
