import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
  tools: { fileEdit: false, terminal: false, webFetch: false },
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
    render(<AgentPanel />)

    expect(screen.getByText('Create Agent')).toBeInTheDocument()
    const nameInput = screen.getByPlaceholderText('Agent name...')
    expect(nameInput).toHaveValue('')
    expect(screen.getByText('Create')).toBeInTheDocument()
  })
})

describe('AgentPanel — Edit Mode (agent-r-2)', () => {
  it('agent-r-2: opens with populated config for existing agent', () => {
    setupEditMode()
    render(<AgentPanel />)

    expect(screen.getByText('Edit Agent')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Agent name...')).toHaveValue('Test Agent')
    expect(screen.getByText('Save')).toBeInTheDocument()
  })
})

describe('AgentPanel — Field Updates', () => {
  it('agent-r-3: name field updates config', async () => {
    setupEditMode()
    render(<AgentPanel />)

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
    render(<AgentPanel />)

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
    render(<AgentPanel />)

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
    render(<AgentPanel />)

    const modelSelect = screen.getAllByRole('combobox')[0]
    const options = within(modelSelect).getAllByRole('option')
    const values = options.map((o) => o.textContent)
    expect(values).toContain('default')
    expect(values).toContain('gpt-4o')
    expect(values).toContain('gpt-4o-mini')
    expect(values).toContain('claude-3.5-sonnet')
    expect(values).toContain('o1-preview')
  })

  it('agent-r-7: toggle agentic mode updates config', async () => {
    setupEditMode()
    render(<AgentPanel />)

    const checkbox = screen.getByRole('checkbox', { name: /agentic mode/i })
    await user.click(checkbox)
    await user.click(screen.getByText('Save'))

    expect(mockStore.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agenticMode: true })
    )
  })

  it('agent-r-8: tool toggles update config', async () => {
    setupEditMode()
    render(<AgentPanel />)

    const fileEditCheckbox = screen.getByRole('checkbox', { name: /file edit/i })
    await user.click(fileEditCheckbox)
    await user.click(screen.getByText('Save'))

    expect(mockStore.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({ fileEdit: true })
      })
    )
  })
})

describe('AgentPanel — Context Management', () => {
  it('agent-r-9: add context directory appends to list', async () => {
    mockApi.openDirectoryDialog = vi.fn().mockResolvedValue(['/new/dir'])
    setupEditMode()
    render(<AgentPanel />)

    await user.click(screen.getByText('+ Add Directory'))
    await user.click(screen.getByText('Save'))

    expect(mockStore.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        contextDirectories: ['/home/user/project', '/new/dir']
      })
    )
  })

  it('agent-r-11: remove context directory updates list', async () => {
    setupEditMode()
    render(<AgentPanel />)

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
    render(<AgentPanel />)

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
    render(<AgentPanel />)

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
      tools: { fileEdit: true, terminal: false, webFetch: false },
      responseFormat: 'concise'
    }
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(textarea, { target: { value: JSON.stringify(newConfig) } })
    await user.click(screen.getByText('Apply JSON'))

    expect(screen.getByPlaceholderText('Agent name...')).toHaveValue('JSON Edited')
  })

  it('agent-r-14: invalid JSON shows error and does not apply', async () => {
    setupEditMode()
    render(<AgentPanel />)

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
    render(<AgentPanel />)

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
    render(<AgentPanel />)

    const createBtn = screen.getByText('Create')
    expect(createBtn).toBeDisabled()
  })

  it('agent-r-16: delete button calls deleteAgent', async () => {
    setupEditMode()
    render(<AgentPanel />)

    await user.click(screen.getByText('Delete'))
    expect(mockStore.deleteAgent).toHaveBeenCalledWith('agent-1')
  })

  it('agent-r-17: delete button hidden for default agents', () => {
    setupEditMode(DEFAULT_AGENT)
    render(<AgentPanel />)

    expect(screen.queryByText('Delete')).not.toBeInTheDocument()
  })

  it('agent-r-18: duplicate button calls duplicateAgent', async () => {
    setupEditMode()
    render(<AgentPanel />)

    await user.click(screen.getByText('Duplicate'))
    expect(mockStore.duplicateAgent).toHaveBeenCalledWith('agent-1')
  })

  it('agent-r-19: export button calls exportAgent', async () => {
    setupEditMode()
    render(<AgentPanel />)

    await user.click(screen.getByText('Export'))
    expect(mockStore.exportAgent).toHaveBeenCalledWith('agent-1')
  })

  it('agent-r-20: close button calls closeAgentPanel', async () => {
    setupEditMode({ ...SAMPLE_AGENT, contextDirectories: [], contextFiles: [] })
    render(<AgentPanel />)

    const dialog = screen.getByRole('dialog')
    const header = dialog.querySelector('.border-b')!
    const closeBtn = within(header as HTMLElement).getByText('✕')
    await user.click(closeBtn)
    expect(mockStore.closeAgentPanel).toHaveBeenCalledTimes(1)
  })

  it('duplicate/export buttons hidden in create mode', () => {
    setupCreateMode()
    render(<AgentPanel />)

    expect(screen.queryByText('Duplicate')).not.toBeInTheDocument()
    expect(screen.queryByText('Export')).not.toBeInTheDocument()
  })
})
