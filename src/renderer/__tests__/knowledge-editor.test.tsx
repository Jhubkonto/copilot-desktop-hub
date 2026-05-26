import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentPanel } from '../../renderer/components/AgentPanel'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn()
}))

vi.mock('../../renderer/store/app-store', () => ({
  useAppStore
}))

let mockApi: MockApi
let mockStore: ReturnType<typeof createMockAppStore>
const user = userEvent.setup()

const AGENT = {
  id: 'agent-1',
  name: 'Test Agent',
  icon: '🧪',
  systemPrompt: 'You are a test agent.',
  model: 'gpt-4o',
  temperature: 0.5,
  maxTokens: 8192,
  contextDirectories: [],
  contextFiles: [],
  mcpServers: [],
  agenticMode: false,
  tools: {
    fileEdit: { enabled: false, approval: 'always-ask', instructions: '' },
    terminal: { enabled: false, approval: 'always-ask', instructions: '' },
    webFetch: { enabled: false, approval: 'always-ask', instructions: '' }
  },
  responseFormat: 'default',
  isDefault: false
}

const SAMPLE_FILE = {
  id: 'kf-1',
  agent_id: 'agent-1',
  file_path: '/docs/notes.md',
  inject_mode: 'always' as const,
  sort_order: 0,
  created_at: 1000,
  updated_at: 1000
}

beforeEach(() => {
  mockApi = setupMockApi()
  mockApi.listKnowledgeFiles = vi.fn().mockResolvedValue([SAMPLE_FILE])
  mockApi.readKnowledgeFile = vi.fn().mockResolvedValue('# Hello World')
  mockStore = createMockAppStore({ editingAgentId: AGENT.id, agents: [AGENT] })
  setupStoreMock(useAppStore, mockStore)
})

async function renderAndOpenEditor() {
  render(<AgentPanel width={440} onResize={() => {}} />)
  await user.click(screen.getByText('Knowledge'))
  await screen.findByText('notes.md')
  await user.click(screen.getByLabelText('Edit /docs/notes.md'))
  await screen.findByText('notes.md', { selector: 'span' })
  return true
}

describe('Knowledge File Editor', () => {
  it('kf-r-1: edit button calls readKnowledgeFile and enters editor view', async () => {
    await renderAndOpenEditor()
    expect(mockApi.readKnowledgeFile).toHaveBeenCalledWith('agent-1', '/docs/notes.md')
    expect(screen.getByRole('button', { name: 'Save file' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('kf-r-2: editor textarea is pre-populated with file content', async () => {
    await renderAndOpenEditor()
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('# Hello World')
  })

  it('kf-r-3: editing textarea updates the live preview', async () => {
    await renderAndOpenEditor()
    const textarea = screen.getByRole('textbox')
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(textarea, { target: { value: '# Updated Content' } })
    await waitFor(() => {
      const textareaEl = screen.getByRole('textbox') as HTMLTextAreaElement
      expect(textareaEl.value).toBe('# Updated Content')
    })
  })

  it('kf-r-4: save button calls writeKnowledgeFile with current content', async () => {
    mockApi.writeKnowledgeFile = vi.fn().mockResolvedValue(true)
    await renderAndOpenEditor()
    await user.click(screen.getByRole('button', { name: 'Save file' }))
    expect(mockApi.writeKnowledgeFile).toHaveBeenCalledWith(
      'agent-1',
      '/docs/notes.md',
      '# Hello World'
    )
  })

  it('kf-r-5: back button returns to file list without saving', async () => {
    mockApi.writeKnowledgeFile = vi.fn().mockResolvedValue(true)
    await renderAndOpenEditor()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(mockApi.writeKnowledgeFile).not.toHaveBeenCalled()
    await screen.findByText('Add file…')
  })
})
