import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SkillPanel } from '../components/SkillPanel'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'
import type { SkillConfig } from '../../shared/types'

const { useAppStore } = vi.hoisted(() => ({ useAppStore: vi.fn() }))
vi.mock('../store/app-store', () => ({ useAppStore }))

const SKILL: SkillConfig = {
  id: 'simplify-code',
  name: 'simplify-code',
  icon: '✨',
  description: 'Review recent code changes.',
  instructions: 'Review the current changes.',
  tags: [],
  tools: {
    fileEdit: { enabled: false, approval: 'always-ask', instructions: '' },
    terminal: { enabled: false, approval: 'always-ask', instructions: '' },
    webFetch: { enabled: false, approval: 'always-ask', instructions: '' },
  },
  mcpServers: [],
  mcpServerTrust: [],
  mcpToolOverrides: [],
  knowledge: [],
  packageFiles: [],
}

describe('SkillPanel', () => {
  beforeEach(() => {
    setupStoreMock(useAppStore, createMockAppStore({
      skills: [SKILL],
      editingSkillId: SKILL.id,
      showSkillPanel: true,
    }))
  })

  it('resizes the instructions field within the visible editor body', () => {
    render(<SkillPanel />)

    const resizeHandle = screen.getByRole('slider', { name: 'Resize skill instructions' })
    const editorBody = resizeHandle.closest('[class*="overflow-y-auto"]') as HTMLElement
    const instructionsBox = resizeHandle.parentElement as HTMLElement
    const tags = screen.getByPlaceholderText('Tags, comma separated')
    const packageSection = screen.getByText('Package').parentElement as HTMLElement

    Object.defineProperty(editorBody, 'clientHeight', { configurable: true, value: 760 })
    editorBody.getBoundingClientRect = () => ({ top: 0, bottom: 760, left: 0, right: 440, width: 440, height: 760, x: 0, y: 0, toJSON: () => ({}) })
    instructionsBox.getBoundingClientRect = () => ({ top: 240, bottom: 520, left: 0, right: 440, width: 440, height: 280, x: 0, y: 240, toJSON: () => ({}) })
    tags.getBoundingClientRect = () => ({ top: 530, bottom: 560, left: 0, right: 440, width: 440, height: 30, x: 0, y: 530, toJSON: () => ({}) })
    packageSection.getBoundingClientRect = () => ({ top: 570, bottom: 720, left: 0, right: 440, width: 440, height: 150, x: 0, y: 570, toJSON: () => ({}) })

    fireEvent.pointerDown(resizeHandle, { button: 0, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(resizeHandle, { clientY: 300, pointerId: 1 })
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '312')

    fireEvent.pointerMove(resizeHandle, { clientY: -500, pointerId: 1 })
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '180')
    fireEvent.pointerUp(resizeHandle, { pointerId: 1 })
  })
})
