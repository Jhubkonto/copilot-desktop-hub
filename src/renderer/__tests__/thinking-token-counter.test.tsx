import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThinkingBlock } from '../components/chat/ThinkingBlock'

describe('ThinkingBlock live token counter', () => {
  it('counts visible reasoning tokens while the block is still streaming', () => {
    const { rerender } = render(<ThinkingBlock content="abcd" done={false} />)
    expect(screen.getByText('Reasoning · ~1 token')).toBeInTheDocument()

    rerender(<ThinkingBlock content="abcdefghijklmnopqrst" done={false} />)
    expect(screen.getByText('Reasoning · ~5 tokens')).toBeInTheDocument()
  })

  it('keeps the final approximate count after thinking completes', () => {
    render(<ThinkingBlock content="abcdefghijklmnopqrst" done={true} />)
    expect(screen.getByText('Reasoning · ~5 tokens')).toBeInTheDocument()
  })
})
