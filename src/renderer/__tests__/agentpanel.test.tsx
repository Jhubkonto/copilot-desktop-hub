import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentPanel } from '../../renderer/components/AgentPanel'
import { setupMockApi, type MockApi } from '../../test/mocks/api'

let mockApi: MockApi
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

describe('AgentPanel — Create Mode (agent-r-1)', () => {
  it('agent-r-1: opens with empty config for new agent', () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(<AgentPanel agent={null} onSave={onSave} onClose={onClose} />)

    expect(screen.getByText('Create Agent')).toBeInTheDocument()
    const nameInput = screen.getByPlaceholderText('Agent name...')
    expect(nameInput).toHaveValue('')
    expect(screen.getByText('Create')).toBeInTheDocument()
  })
})

describe('AgentPanel — Edit Mode (agent-r-2)', () => {
  it('agent-r-2: opens with populated config for existing agent', () => {
    render(
      <AgentPanel agent={SAMPLE_AGENT} onSave={vi.fn()} onClose={vi.fn()} />
    )

    expect(screen.getByText('Edit Agent')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Agent name...')).toHaveValue('Test Agent')
    expect(screen.getByText('Save')).toBeInTheDocument()
  })
})

describe('AgentPanel — Field Updates', () => {
  it('agent-r-3: name field updates config', async () => {
    const onSave = vi.fn()
    render(
      <AgentPanel agent={SAMPLE_AGENT} onSave={onSave} onClose={vi.fn()} />
    )

    const nameInput = screen.getByPlaceholderText('Agent name...')
    await user.clear(nameInput)
    await user.type(nameInput, 'New Name')
    await user.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Name' })
    )
  })

  it('agent-r-4: system prompt textarea updates config', async () => {
    const onSave = vi.fn()
    render(
      <AgentPanel agent={SAMPLE_AGENT} onSave={onSave} onClose={vi.fn()} />
    )

    const textarea = screen.getByPlaceholderText('Instructions for the agent...')
    await user.clear(textarea)
    await user.type(textarea, 'New prompt')
    await user.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: 'New prompt' })
    )
  })

  it('agent-r-5: temperature slider updates config', async () => {
    const onSave = vi.fn()
    render(
      <AgentPanel agent={SAMPLE_AGENT} onSave={onSave} onClose={vi.fn()} />
    )

    // Temperature slider is a range input
    const slider = screen.getByRole('slider')
    // fireEvent is needed for range inputs since userEvent doesn't support them well
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(slider, { target: { value: '0.9' } })
    await user.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.9 })
    )
  })

  it('agent-r-6: model dropdown shows available models', () => {
    render(
      <AgentPanel agent={SAMPLE_AGENT} onSave={vi.fn()} onClose={vi.fn()} />
    )

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
    const onSave = vi.fn()
    render(
      <AgentPanel agent={SAMPLE_AGENT} onSave={onSave} onClose={vi.fn()} />
    )

    const checkbox = screen.getByRole('checkbox', { name: /agentic mode/i })
    await user.click(checkbox)
    await user.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ agenticMode: true })
    )
  })

  it('agent-r-8: tool toggles update config', async () => {
    const onSave = vi.fn()
    render(
      <AgentPanel agent={SAMPLE_AGENT} onSave={onSave} onClose={vi.fn()} />
    )

    const fileEditCheckbox = screen.getByRole('checkbox', { name: /file edit/i })
    await user.click(fileEditCheckbox)
    await user.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({ fileEdit: true })
      })
    )
  })
})

describe('AgentPanel — Context Management', () => {
  it('agent-r-9: add context directory appends to list', async () => {
    mockApi.openDirectoryDialog = vi.fn().mockResolvedValue(['/new/dir'])
    const onSave = vi.fn()
    render(
      <AgentPanel agent={SAMPLE_AGENT} onSave={onSave} onClose={vi.fn()} />
    )

    await user.click(screen.getByText('+ Add Directory'))
    await user.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        contextDirectories: ['/home/user/project', '/new/dir']
      })
    )
  })

  it('agent-r-11: remove context directory updates list', async () => {
    const onSave = vi.fn()
    render(
      <AgentPanel agent={SAMPLE_AGENT} onSave={onSave} onClose={vi.fn()} />
    )

    // Find the remove button for the existing directory
    const dirItem = screen.getByTitle('/home/user/project')
    const removeBtn = dirItem.closest('div')!.querySelector('button')!
    await user.click(removeBtn)
    await user.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ contextDirectories: [] })
    )
  })
})

describe('AgentPanel — JSON Tab', () => {
  it('agent-r-12: JSON tab shows serialized config', async () => {
    render(
      <AgentPanel agent={SAMPLE_AGENT} onSave={vi.fn()} onClose={vi.fn()} />
    )

    // Switch to JSON tab
    await user.click(screen.getByText('{ } JSON'))

    // JSON textarea should contain the config (without id and isDefault)
    const textarea = screen.getByRole('textbox')
    const jsonContent = (textarea as HTMLTextAreaElement).value
    const parsed = JSON.parse(jsonContent)
    expect(parsed.name).toBe('Test Agent')
    expect(parsed.id).toBeUndefined()
    expect(parsed.isDefault).toBeUndefined()
  })

  it('agent-r-13: valid JSON edit updates config on apply', async () => {
    const onSave = vi.fn()
    render(
      <AgentPanel agent={SAMPLE_AGENT} onSave={onSave} onClose={vi.fn()} />
    )

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
    // Use fireEvent.change since user.type interprets { as keyboard modifier
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(textarea, { target: { value: JSON.stringify(newConfig) } })
    await user.click(screen.getByText('Apply JSON'))

    // Should switch back to settings tab and have the updated name
    expect(screen.getByPlaceholderText('Agent name...')).toHaveValue('JSON Edited')
  })

  it('agent-r-14: invalid JSON shows error and does not apply', async () => {
    render(
      <AgentPanel agent={SAMPLE_AGENT} onSave={vi.fn()} onClose={vi.fn()} />
    )

    await user.click(screen.getByText('{ } JSON'))

    const textarea = screen.getByRole('textbox')
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(textarea, { target: { value: 'not valid json' } })
    await user.click(screen.getByText('Apply JSON'))

    expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument()
  })
})

describe('AgentPanel — Actions', () => {
  it('agent-r-15: save button calls onSave with correct config', async () => {
    const onSave = vi.fn()
    render(
      <AgentPanel agent={SAMPLE_AGENT} onSave={onSave} onClose={vi.fn()} />
    )

    await user.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agent-1',
        name: 'Test Agent',
        icon: '🧪'
      })
    )
  })

  it('save disabled when name is empty', () => {
    render(
      <AgentPanel agent={null} onSave={vi.fn()} onClose={vi.fn()} />
    )

    const createBtn = screen.getByText('Create')
    expect(createBtn).toBeDisabled()
  })

  it('agent-r-16: delete button calls onDelete', async () => {
    const onDelete = vi.fn()
    render(
      <AgentPanel
        agent={SAMPLE_AGENT}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onDelete={onDelete}
      />
    )

    await user.click(screen.getByText('Delete'))
    expect(onDelete).toHaveBeenCalledWith('agent-1')
  })

  it('agent-r-17: delete button hidden for default agents', () => {
    render(
      <AgentPanel
        agent={DEFAULT_AGENT}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.queryByText('Delete')).not.toBeInTheDocument()
  })

  it('agent-r-18: duplicate button calls onDuplicate', async () => {
    const onDuplicate = vi.fn()
    render(
      <AgentPanel
        agent={SAMPLE_AGENT}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onDuplicate={onDuplicate}
      />
    )

    await user.click(screen.getByText('Duplicate'))
    expect(onDuplicate).toHaveBeenCalledWith('agent-1')
  })

  it('agent-r-19: export button calls onExport', async () => {
    const onExport = vi.fn()
    render(
      <AgentPanel
        agent={SAMPLE_AGENT}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onExport={onExport}
      />
    )

    await user.click(screen.getByText('Export'))
    expect(onExport).toHaveBeenCalledWith('agent-1')
  })

  it('agent-r-20: close button calls onClose', async () => {
    const onClose = vi.fn()
    render(
      <AgentPanel agent={{ ...SAMPLE_AGENT, contextDirectories: [], contextFiles: [] }} onSave={vi.fn()} onClose={onClose} />
    )

    // The close button is in the header — use the dialog's header area
    const dialog = screen.getByRole('dialog')
    const header = dialog.querySelector('.border-b')!
    const closeBtn = within(header as HTMLElement).getByText('✕')
    await user.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('duplicate/export buttons hidden in create mode', () => {
    render(
      <AgentPanel
        agent={null}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        onExport={vi.fn()}
      />
    )

    expect(screen.queryByText('Duplicate')).not.toBeInTheDocument()
    expect(screen.queryByText('Export')).not.toBeInTheDocument()
  })
})
