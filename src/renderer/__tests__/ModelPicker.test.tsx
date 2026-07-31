import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModelPicker } from '../components/chat/ModelPicker'

describe('ModelPicker', () => {
  it('ellipsizes long model labels and exposes the full label on hover', () => {
    const longLabel = 'Claude Haiku 4.5 20251001 extended reasoning'

    render(
      <ModelPicker
        value="claude-haiku-long"
        sourceLabel="global"
        availableGroups={[]}
        catalogModels={[{
          id: 'claude-haiku-long',
          name: longLabel,
          vendor: 'Anthropic',
          capabilities: [],
        }]}
        onSelectAvailableModel={vi.fn()}
      />,
    )

    const button = screen.getByRole('button', {
      name: `Conversation model: ${longLabel} · via global`,
    })
    expect(button).toHaveAttribute('title', `${longLabel} · via global`)
    expect(screen.getByText(longLabel)).toHaveClass('truncate', 'max-w-[140px]')
  })
})
