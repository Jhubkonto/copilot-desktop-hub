import { describe, it, expect } from 'vitest'
import { isValidHermesProfile, HERMES_PROFILE_RE } from '@shared/hermes'

describe('isValidHermesProfile', () => {
  it('accepts real Hermes profile names', () => {
    expect(isValidHermesProfile('default')).toBe(true)
    expect(isValidHermesProfile('localllm')).toBe(true)
    expect(isValidHermesProfile('localllm-iso')).toBe(true)
    expect(isValidHermesProfile('a')).toBe(true)
    expect(isValidHermesProfile('9')).toBe(true)
    expect(isValidHermesProfile('my_profile-2')).toBe(true)
  })

  it('rejects uppercase (Hermes lowercases/rejects)', () => {
    expect(isValidHermesProfile('Coder')).toBe(false)
    expect(isValidHermesProfile('LocalLLM')).toBe(false)
  })

  it('rejects names not starting alphanumeric', () => {
    expect(isValidHermesProfile('-x')).toBe(false)
    expect(isValidHermesProfile('_x')).toBe(false)
  })

  it('rejects empty and over-length names', () => {
    expect(isValidHermesProfile('')).toBe(false)
    expect(isValidHermesProfile('a'.repeat(65))).toBe(false)
    expect(isValidHermesProfile('a'.repeat(64))).toBe(true)
  })

  it('rejects illegal characters', () => {
    expect(isValidHermesProfile('my profile')).toBe(false)
    expect(isValidHermesProfile('my.profile')).toBe(false)
    expect(isValidHermesProfile('my/profile')).toBe(false)
  })

  it('exposes the canonical regex mirroring profiles.py', () => {
    expect(HERMES_PROFILE_RE.source).toBe('^[a-z0-9][a-z0-9_-]{0,63}$')
  })
})
