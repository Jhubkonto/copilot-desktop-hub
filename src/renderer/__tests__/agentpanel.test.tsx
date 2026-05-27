import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
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

const SAMPLE_AGENT = {
  id: 'agent-1',
  name: 'Test Agent',
  icon: '🧪',
  systemPrompt: 'You are a test agent.',
  model: 'gpt-4o',
  temperature: 0.5,
  maxTokens: 8192,
  contextDirectories: ['/home/user/project'],
  contextFiles: ['/home/user/project/main.ts'],
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

const DEFAULT_AGENT = {
  ...SAMPLE_AGENT,
  id: 'default-1',
  name: 'General Assistant',
  isDefault: true
}

beforeEach(() => {
  mockApi = setupMockApi()
})

function setupEditMode(agent = SAMPLE_AGENT) {
  mockStore = createMockAppStore({
    editingAgentId: agent.id,
    agents: [agent]
  })
  setupStoreMock(useAppStore, mockStore)
}

function setupCreateMode() {
  mockStore = createMockAppStore({
    editingAgentId: null,
    agents: []
  })
  setupStoreMock(useAppStore, mockStore)
}

describe('AgentPanel — Create Mode (agent-r-1)', () => {
  it('agent-r-1: opens with empty config for new agent', () => {
    setupCreateMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    expect(screen.getByText('Create Agent')).toBeInTheDocument()
    const nameInput = screen.getByPlaceholderText('Agent name...')
    expect(nameInput).toHaveValue('')
    expect(screen.getByText('Create')).toBeInTheDocument()
  })
})

describe('AgentPanel — Edit Mode (agent-r-2)', () => {
  it('agent-r-2: opens with populated config for existing agent', () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    expect(screen.getByText('Edit Agent')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Agent name...')).toHaveValue('Test Agent')
    expect(screen.getByText('Save')).toBeInTheDocument()
  })
})

describe('AgentPanel — Field Updates', () => {
  it('agent-r-3: name field updates config', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    const nameInput = screen.getByPlaceholderText('Agent name...')
    await user.clear(nameInput)
    await user.type(nameInput, 'New Name')
    await user.click(screen.getByText('Save'))

    expect(mockStore.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Name' })
    )
  })

  it('agent-r-4: system prompt textarea updates config', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    const textarea = screen.getByPlaceholderText('Instructions for the agent...')
    await user.clear(textarea)
    await user.type(textarea, 'New prompt')
    await user.click(screen.getByText('Save'))

    expect(mockStore.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: 'New prompt' })
    )
  })

  it('agent-r-5: temperature slider updates config', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    const slider = screen.getByRole('slider')
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(slider, { target: { value: '0.9' } })
    await user.click(screen.getByText('Save'))

    expect(mockStore.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.9 })
    )
  })

  it('agent-r-6: model dropdown shows available models', () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    const modelSelect = screen.getAllByRole('combobox')[0]
    const options = within(modelSelect).getAllByRole('option')
    const values = options.map((o) => o.textContent)
    expect(values).toContain('default')
    expect(values).toContain('gpt-5.4')
    expect(values).toContain('gpt-5.4-mini')
    expect(values).toContain('claude-sonnet-4.5')
    expect(values).toContain('gpt-4.1')
  })

  it('agent-r-7: toggle agentic mode updates config', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    const checkbox = screen.getByRole('checkbox', { name: /agentic mode/i })
    await user.click(checkbox)
    await user.click(screen.getByText('Save'))

    expect(mockStore.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agenticMode: true })
    )
  })

  it('agent-r-8: save preserves structured tool config', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Save'))

    expect(mockStore.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          fileEdit: expect.objectContaining({ enabled: false, approval: 'always-ask', instructions: '' })
        })
      })
    )
  })
})

describe('AgentPanel — Skills tab', () => {
  it('ap-skills-1: Skills tab renders one card per built-in tool', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Skills'))
    expect(await screen.findByText('🗂 File Edit')).toBeInTheDocument()
    expect(screen.getByText('💻 Terminal')).toBeInTheDocument()
    expect(screen.getByText('🌐 Web Fetch')).toBeInTheDocument()
  })

  it('ap-skills-2: Enabled toggle updates agent config on save', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Skills'))
    await user.click(screen.getByRole('button', { name: /toggle file edit/i }))
    await user.click(screen.getByText('Save'))

    expect(mockStore.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          fileEdit: expect.objectContaining({ enabled: true })
        })
      })
    )
  })

  it('ap-skills-3: Approval dropdown renders Auto/Always ask/Disabled options', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Skills'))
    const select = screen.getAllByRole('combobox').find((el) => (el as HTMLSelectElement).value === 'always-ask') as HTMLSelectElement
    const options = Array.from(select.options).map((option) => option.text)
    expect(options).toEqual(expect.arrayContaining(['Auto', 'Always ask', 'Disabled']))
  })

  it('ap-skills-4: Instructions textarea updates on change', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Skills'))
    const textareas = screen.getAllByRole('textbox')
    await user.type(textareas[0], 'Only edit src files')
    await user.click(screen.getByText('Save'))

    expect(mockStore.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          fileEdit: expect.objectContaining({ instructions: 'Only edit src files' })
        })
      })
    )
  })

  it('ap-skills-5: MCP tool cards rendered for tools returned by listMcpToolsForAgent', async () => {
    mockApi.listMcpToolsForAgent = vi.fn().mockResolvedValue([
      { name: 'search_code', serverId: 'github', serverName: 'GitHub', description: 'Search code' }
    ])
    mockApi.getMcpToolOverrides = vi.fn().mockResolvedValue([])
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Skills'))

    expect(await screen.findByText('🔌 search_code')).toBeInTheDocument()
    expect(screen.getByText('via GitHub')).toBeInTheDocument()
  })
})

describe('AgentPanel — Context Management', () => {
  it('agent-r-9: add context directory appends to list', async () => {
    mockApi.openDirectoryDialog = vi.fn().mockResolvedValue(['/new/dir'])
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Add Directory'))
    await user.click(screen.getByText('Save'))

    expect(mockStore.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        contextDirectories: ['/home/user/project', '/new/dir']
      })
    )
  })

  it('agent-r-11: remove context directory updates list', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    const dirItem = screen.getByTitle('/home/user/project')
    const removeBtn = dirItem.closest('div')!.querySelector('button')!
    await user.click(removeBtn)
    await user.click(screen.getByText('Save'))

    expect(mockStore.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({ contextDirectories: [] })
    )
  })
})

describe('AgentPanel — JSON Tab', () => {
  it('agent-r-12: JSON tab shows serialized config', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('{ } JSON'))

    const textarea = screen.getByRole('textbox')
    const jsonContent = (textarea as HTMLTextAreaElement).value
    const parsed = JSON.parse(jsonContent)
    expect(parsed.name).toBe('Test Agent')
    expect(parsed.id).toBeUndefined()
    expect(parsed.isDefault).toBeUndefined()
  })

  it('agent-r-13: valid JSON edit updates config on apply', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('{ } JSON'))

    const textarea = screen.getByRole('textbox')
    const newConfig = {
      name: 'JSON Edited',
      icon: '🚀',
      systemPrompt: 'Edited via JSON',
      model: 'default',
      temperature: 0.3,
      maxTokens: 2048,
      contextDirectories: [],
      contextFiles: [],
      mcpServers: [],
      agenticMode: true,
      tools: {
        fileEdit: { enabled: true, approval: 'auto', instructions: 'Use for src only' },
        terminal: { enabled: false, approval: 'always-ask', instructions: '' },
        webFetch: { enabled: false, approval: 'disabled', instructions: '' }
      },
      responseFormat: 'concise'
    }
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(textarea, { target: { value: JSON.stringify(newConfig) } })
    await user.click(screen.getByText('Apply JSON'))

    expect(screen.getByPlaceholderText('Agent name...')).toHaveValue('JSON Edited')
  })

  it('agent-r-14: invalid JSON shows error and does not apply', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('{ } JSON'))

    const textarea = screen.getByRole('textbox')
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(textarea, { target: { value: 'not valid json' } })
    await user.click(screen.getByText('Apply JSON'))

    expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument()
  })
})

describe('AgentPanel — Actions', () => {
  it('agent-r-15: save button calls saveAgent with correct config', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Save'))

    expect(mockStore.saveAgent).toHaveBeenCalledTimes(1)
    expect(mockStore.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agent-1',
        name: 'Test Agent',
        icon: '🧪'
      })
    )
  })

  it('save disabled when name is empty', () => {
    setupCreateMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    const createBtn = screen.getByText('Create')
    expect(createBtn).toBeDisabled()
  })

  it('agent-r-16: delete button calls deleteAgent', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Delete'))
    expect(mockStore.deleteAgent).toHaveBeenCalledWith('agent-1')
  })

  it('agent-r-17: delete button visible for default agents', () => {
    setupEditMode(DEFAULT_AGENT)
    render(<AgentPanel width={440} onResize={() => {}} />)

    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('agent-r-18: duplicate button calls duplicateAgent', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Duplicate'))
    expect(mockStore.duplicateAgent).toHaveBeenCalledWith('agent-1')
  })

  it('agent-r-19: export button calls exportAgent', async () => {
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Export'))
    expect(mockStore.exportAgent).toHaveBeenCalledWith('agent-1')
  })

  it('agent-r-20: close button calls closeAgentPanel', async () => {
    setupEditMode({ ...SAMPLE_AGENT, contextDirectories: [], contextFiles: [] })
    render(<AgentPanel width={440} onResize={() => {}} />)

    const dialog = screen.getByRole('dialog')
    const header = dialog.querySelector('.border-b')!
    const closeBtn = within(header as HTMLElement).getByLabelText('Close agent panel')
    await user.click(closeBtn)
    expect(mockStore.closeAgentPanel).toHaveBeenCalledTimes(1)
  })

  it('duplicate/export buttons hidden in create mode', () => {
    setupCreateMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    expect(screen.queryByText('Duplicate')).not.toBeInTheDocument()
    expect(screen.queryByText('Export')).not.toBeInTheDocument()
  })
})

const SAMPLE_FILE = {
  id: 'kf-1',
  agent_id: 'agent-1',
  file_path: '/docs/notes.md',
  inject_mode: 'always' as const,
  sort_order: 0,
  created_at: 1000,
  updated_at: 1000
}

describe('AgentPanel — Knowledge Tab', () => {
  it('agent-r-21: shows "Save agent first" message in create mode', async () => {
    setupCreateMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Knowledge'))
    expect(screen.getByText(/Save the agent first/)).toBeInTheDocument()
  })

  it('agent-r-22: shows empty state when no files registered', async () => {
    mockApi.listKnowledgeFiles = vi.fn().mockResolvedValue([])
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Knowledge'))
    await screen.findByText(/No knowledge files yet/)
  })

  it('agent-r-23: calls listKnowledgeFiles with agent id on tab switch', async () => {
    mockApi.listKnowledgeFiles = vi.fn().mockResolvedValue([])
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Knowledge'))
    await waitFor(() => expect(mockApi.listKnowledgeFiles).toHaveBeenCalledWith('agent-1'))
  })

  it('agent-r-24: renders file row with filename, inject-mode pill, edit and remove buttons', async () => {
    mockApi.listKnowledgeFiles = vi.fn().mockResolvedValue([SAMPLE_FILE])
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Knowledge'))
    await screen.findByText('notes.md')

    expect(screen.getByText('Always')).toBeInTheDocument()
    expect(screen.getByLabelText('Edit /docs/notes.md')).toBeInTheDocument()
    expect(screen.getByLabelText('Remove /docs/notes.md')).toBeInTheDocument()
  })

  it('agent-r-25: inject-mode pill toggles mode and calls updateKnowledgeInjectMode', async () => {
    mockApi.listKnowledgeFiles = vi.fn().mockResolvedValue([SAMPLE_FILE])
    mockApi.updateKnowledgeInjectMode = vi.fn().mockResolvedValue(true)
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Knowledge'))
    await screen.findByText('Always')

    await user.click(screen.getByTitle('Toggle inject mode'))
    expect(mockApi.updateKnowledgeInjectMode).toHaveBeenCalledWith('kf-1', 'on-demand')
    await screen.findByText('On demand')
  })

  it('agent-r-26: remove button calls removeKnowledgeFile and removes row', async () => {
    mockApi.listKnowledgeFiles = vi.fn().mockResolvedValue([SAMPLE_FILE])
    mockApi.removeKnowledgeFile = vi.fn().mockResolvedValue(true)
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Knowledge'))
    await screen.findByText('notes.md')

    await user.click(screen.getByLabelText('Remove /docs/notes.md'))
    expect(mockApi.removeKnowledgeFile).toHaveBeenCalledWith('kf-1')
    await waitFor(() => expect(screen.queryByText('notes.md')).not.toBeInTheDocument())
  })

  it('agent-r-27: add file button calls openFileDialog then addKnowledgeFile', async () => {
    const newFile = { ...SAMPLE_FILE, id: 'kf-2', file_path: '/docs/new-file.md' }
    mockApi.listKnowledgeFiles = vi.fn().mockResolvedValue([])
    mockApi.openFileDialog = vi.fn().mockResolvedValue([
      { path: '/docs/new-file.md', name: 'new-file.md', id: 'f-1', size: 100 }
    ])
    mockApi.addKnowledgeFile = vi.fn().mockResolvedValue(newFile)
    setupEditMode()
    render(<AgentPanel width={440} onResize={() => {}} />)

    await user.click(screen.getByText('Knowledge'))
    await screen.findByText(/No knowledge files yet/)

    await user.click(screen.getByText('Add file…'))
    await screen.findByText('new-file.md')
    expect(mockApi.openFileDialog).toHaveBeenCalled()
    expect(mockApi.addKnowledgeFile).toHaveBeenCalledWith('agent-1', '/docs/new-file.md', 'always')
  })
})
