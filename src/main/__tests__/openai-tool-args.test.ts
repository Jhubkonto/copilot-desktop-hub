import { describe, it, expect, vi } from 'vitest'

// openai-provider pulls in the streaming/http layer transitively; stub the pieces that touch
// electron/native modules so the pure argument-parsing helper can be imported in isolation.
vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { parseToolArguments } from '../providers/openai-provider'

describe('parseToolArguments', () => {
  it('parses well-formed JSON object arguments', () => {
    const { args, error } = parseToolArguments('{"path":"a.txt","content":"hi"}')
    expect(error).toBeUndefined()
    expect(args).toEqual({ path: 'a.txt', content: 'hi' })
  })

  it('treats empty / {} arguments as no arguments without error', () => {
    expect(parseToolArguments('')).toEqual({ args: {} })
    expect(parseToolArguments('   ')).toEqual({ args: {} })
    expect(parseToolArguments('{}')).toEqual({ args: {} })
  })

  it('repairs trailing commas', () => {
    const { args, error } = parseToolArguments('{"a":1,"b":2,}')
    expect(error).toBeUndefined()
    expect(args).toEqual({ a: 1, b: 2 })
  })

  it('recovers the first balanced object when the model concatenates fragments', () => {
    const { args, error } = parseToolArguments('{"a":1}{"b":2}')
    expect(error).toBeUndefined()
    expect(args).toEqual({ a: 1 })
  })

  it('reports an error (rather than silently returning {}) for unrepairable garbage', () => {
    const { args, error } = parseToolArguments('not json at all')
    expect(args).toEqual({})
    expect(error).toMatch(/could not parse arguments as JSON/)
  })

  it('reports an error when arguments parse to a non-object', () => {
    const { args, error } = parseToolArguments('[1,2,3]')
    expect(args).toEqual({})
    expect(error).toBeTruthy()
  })
})
