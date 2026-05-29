import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectSettingsPanel } from '../components/ProjectSettingsPanel'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'
import { setupMockApi } from '../../test/mocks/api'
import type { ProjectConfig } from '../store/types'

const { useAppStore } = vi.hoisted(() => ({ useAppStore: vi.fn() }))
vi.mock('../store/app-store', () => ({ useAppStore }))

const BASE_CONFIG: ProjectConfig = {
  instructions: 'Do stuff',
  rootDirectory: '/tmp/project',
  variables: [],
  instructionMode: 'prepend',
  instructionsEnabled: true,
  orchestrationEnabled: false,
  maxDelegationDepth: 5,
  showTeamActivity: true,
  inScope: [],
  outOfScope: [],
  milestones: [],
}

const PROJECT = { id: 'proj-1', name: 'My Project', color: 'blue', created_at: 0, default_model: null }

let mockStore: ReturnType<typeof createMockAppStore>
let user: ReturnType<typeof userEvent.setup>

beforeEach(() => {
  user = userEvent.setup()
  vi.clearAllMocks()
  setupMockApi()
  mockStore = createMockAppStore({
    projects: [PROJECT],
    projectConfigs: { 'proj-1': BASE_CONFIG },
    activeProjectId: 'proj-1',
    agents: [],
    agentsLoading: false,
    conversations: [],
    currentConversationId: null,
    activeAgentId: null,
  })
  setupStoreMock(useAppStore, mockStore)
})

// ── Tab navigation ─────────────────────────────────────────────────────────────

describe('ProjectSettingsPanel — tabs', () => {
  it('k-1: renders all three tabs', () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /general/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /scope/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /milestones/i })).toBeInTheDocument()
  })

  it('k-2: General tab is active by default', () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /general/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText(/project name/i)).toBeInTheDocument()
  })

  it('k-3: initialTab prop selects the correct tab on mount', () => {
    render(<ProjectSettingsPanel projectId="proj-1" initialTab="scope" onClose={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /scope/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('k-4: clicking Scope tab shows In Scope and Out of Scope sections', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /scope/i }))
    expect(screen.getByText(/in scope/i)).toBeInTheDocument()
    expect(screen.getByText(/out of scope/i)).toBeInTheDocument()
  })

  it('k-5: clicking Milestones tab shows milestones content', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /milestones/i }))
    expect(screen.getByRole('button', { name: /add milestone/i })).toBeInTheDocument()
  })
})

// ── Scope tab ──────────────────────────────────────────────────────────────────

describe('ProjectSettingsPanel — scope rules (K.4)', () => {
  it('k-6: Scope tab shows empty-state message when no in-scope rules exist', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /scope/i }))
    expect(screen.getByText(/no in-scope rules/i)).toBeInTheDocument()
    expect(screen.getByText(/no out-of-scope rules/i)).toBeInTheDocument()
  })

  it('k-7: clicking Add in Scope adds a new rule input', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /scope/i }))
    const addBtn = screen.getByRole('button', { name: /add in-scope rule/i })
    await user.click(addBtn)
    expect(screen.getByLabelText(/scope rule description/i)).toBeInTheDocument()
  })

  it('k-8: clicking Add out-of-scope adds a new rule input', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /scope/i }))
    const addBtn = screen.getByRole('button', { name: /add out-of-scope rule/i })
    await user.click(addBtn)
    expect(screen.getByLabelText(/out-of-scope rule description/i)).toBeInTheDocument()
  })

  it('k-9: in-scope rule can be removed', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /scope/i }))
    await user.click(screen.getByRole('button', { name: /add in-scope rule/i }))
    const removeBtn = screen.getByRole('button', { name: /remove in-scope rule/i })
    await user.click(removeBtn)
    expect(screen.queryByLabelText(/scope rule description/i)).not.toBeInTheDocument()
  })

  it('k-10: existing in-scope rules from config are rendered', () => {
    mockStore = createMockAppStore({
      projects: [PROJECT],
      projectConfigs: {
        'proj-1': {
          ...BASE_CONFIG,
          inScope: [{ id: 'r1', description: 'Only src/', pathGlob: 'src/**' }],
        }
      },
      activeProjectId: 'proj-1',
      agents: [],
      agentsLoading: false,
      conversations: [],
      currentConversationId: null,
      activeAgentId: null,
    })
    setupStoreMock(useAppStore, mockStore)
    render(<ProjectSettingsPanel projectId="proj-1" initialTab="scope" onClose={vi.fn()} />)
    const input = screen.getByDisplayValue('Only src/')
    expect(input).toBeInTheDocument()
    const globInput = screen.getByDisplayValue('src/**')
    expect(globInput).toBeInTheDocument()
  })
})

// ── Milestones tab ─────────────────────────────────────────────────────────────

describe('ProjectSettingsPanel — milestones (K.4)', () => {
  it('k-11: shows empty state when no milestones', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /milestones/i }))
    expect(screen.getByText(/no milestones yet/i)).toBeInTheDocument()
  })

  it('k-12: Add milestone button adds a new milestone card', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /milestones/i }))
    await user.click(screen.getByRole('button', { name: /add milestone/i }))
    expect(screen.getByLabelText(/milestone title/i)).toBeInTheDocument()
  })

  it('k-13: new milestone has Set active button', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /milestones/i }))
    await user.click(screen.getByRole('button', { name: /add milestone/i }))
    expect(screen.getByRole('button', { name: /set.*as active/i })).toBeInTheDocument()
  })

  it('k-14: setting a milestone active shows Mark complete button', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /milestones/i }))
    await user.click(screen.getByRole('button', { name: /add milestone/i }))
    const setActiveBtn = screen.getByRole('button', { name: /set.*as active/i })
    await user.click(setActiveBtn)
    expect(screen.getByRole('button', { name: /mark.*as complete/i })).toBeInTheDocument()
  })

  it('k-15: active milestone shows 🎯 indicator in Milestones tab label', async () => {
    mockStore = createMockAppStore({
      projects: [PROJECT],
      projectConfigs: {
        'proj-1': {
          ...BASE_CONFIG,
          milestones: [{ id: 'm1', title: 'Ship v1', status: 'active' }],
        }
      },
      activeProjectId: 'proj-1',
      agents: [],
      agentsLoading: false,
      conversations: [],
      currentConversationId: null,
      activeAgentId: null,
    })
    setupStoreMock(useAppStore, mockStore)
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    expect(screen.getByText(/milestones 🎯/i)).toBeInTheDocument()
  })

  it('k-16: marking active milestone complete shows Reopen button', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /milestones/i }))
    await user.click(screen.getByRole('button', { name: /add milestone/i }))
    await user.click(screen.getByRole('button', { name: /set.*as active/i }))
    await user.click(screen.getByRole('button', { name: /mark.*as complete/i }))
    expect(screen.getByRole('button', { name: /reopen/i })).toBeInTheDocument()
  })

  it('k-17: removing a milestone removes it from the list', async () => {
    render(<ProjectSettingsPanel projectId="proj-1" onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: /milestones/i }))
    await user.click(screen.getByRole('button', { name: /add milestone/i }))
    expect(screen.getByLabelText(/milestone title/i)).toBeInTheDocument()
    const removeBtn = screen.getByRole('button', { name: /remove milestone/i })
    await user.click(removeBtn)
    expect(screen.queryByLabelText(/milestone title/i)).not.toBeInTheDocument()
  })

  it('k-18: existing milestone from config is rendered on Milestones tab', () => {
    mockStore = createMockAppStore({
      projects: [PROJECT],
      projectConfigs: {
        'proj-1': {
          ...BASE_CONFIG,
          milestones: [
            { id: 'm1', title: 'Launch MVP', description: 'First public release', status: 'upcoming' },
          ],
        }
      },
      activeProjectId: 'proj-1',
      agents: [],
      agentsLoading: false,
      conversations: [],
      currentConversationId: null,
      activeAgentId: null,
    })
    setupStoreMock(useAppStore, mockStore)
    render(<ProjectSettingsPanel projectId="proj-1" initialTab="milestones" onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('Launch MVP')).toBeInTheDocument()
    expect(screen.getByDisplayValue('First public release')).toBeInTheDocument()
  })
})

// ── Draft mode ────────────────────────────────────────────────────────────────

describe('ProjectSettingsPanel — draft mode with new fields', () => {
  it('k-19: draft mode renders Create project and Cancel buttons regardless of active tab', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(
      <ProjectSettingsPanel
        draft
        onClose={onClose}
        onConfirm={onConfirm}
        initialTab="milestones"
      />
    )
    expect(screen.getByRole('button', { name: /create project/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('k-20: onConfirm in draft mode includes inScope/outOfScope/milestones', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(
      <ProjectSettingsPanel
        draft
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    )
    const nameInput = screen.getByLabelText(/project name/i)
    await user.type(nameInput, 'My New Project')

    // Switch to Scope tab and add an in-scope rule
    await user.click(screen.getByRole('tab', { name: /scope/i }))
    await user.click(screen.getByRole('button', { name: /add in-scope rule/i }))
    const ruleInput = screen.getByLabelText(/scope rule description/i)
    await user.type(ruleInput, 'TypeScript only')

    // Switch back and create
    await user.click(screen.getByRole('tab', { name: /general/i }))
    fireEvent.click(screen.getByRole('button', { name: /create project/i }))

    expect(onConfirm).toHaveBeenCalledWith(
      'My New Project',
      expect.any(String),
      expect.objectContaining({
        inScope: expect.arrayContaining([expect.objectContaining({ description: 'TypeScript only' })]),
        outOfScope: [],
        milestones: [],
      })
    )
  })
})


