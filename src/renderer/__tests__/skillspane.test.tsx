import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SkillsPane } from '../components/section-pane/SkillsPane'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'
import type { DiscoveredSkill, SkillConfig } from '../../shared/types'

const { useAppStore } = vi.hoisted(() => ({ useAppStore: vi.fn() }))
vi.mock('../store/app-store', () => ({ useAppStore }))

let discoverSkillsMock: ReturnType<typeof vi.fn>

const INVALID_DISCOVERY: DiscoveredSkill = {
  packagePath: 'C:/agents/.claude/skills/swap-tls-certificate',
  name: 'swap-tls-certificate',
  description: '',
  icon: '✨',
  scope: 'project',
  source: 'claude',
  rootLabel: '010600_corevas/.claude/skills',
  validationStatus: 'invalid',
  validationErrors: ['description is required and must explain when to use the skill'],
  importable: true,
  alreadyImported: false,
}

const DISCOVERIES: DiscoveredSkill[] = [
  INVALID_DISCOVERY,
  {
    ...INVALID_DISCOVERY,
    packagePath: 'C:/users/.codex/skills/alpha',
    name: 'alpha',
    description: 'A skill already managed by Nexy',
    scope: 'user',
    source: 'codex',
    rootLabel: '~/.codex/skills',
    validationStatus: 'valid',
    validationErrors: undefined,
    importable: true,
    alreadyImported: true,
  },
  {
    ...INVALID_DISCOVERY,
    packagePath: 'C:/project/.skills/beta',
    name: 'beta',
    description: 'A skill with a metadata warning',
    source: 'filesystem',
    rootLabel: 'project/.skills',
    validationStatus: 'warning',
    validationErrors: undefined,
    validationWarnings: ['name uses a fallback'],
    importable: true,
    alreadyImported: false,
  },
]

const LIBRARY_SKILL: SkillConfig = {
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
}

describe('SkillsPane discovery', () => {
  beforeEach(() => {
    discoverSkillsMock = vi.fn()
    const store = createMockAppStore({
      skills: [],
      discoveredSkills: [INVALID_DISCOVERY],
      discoveringSkills: false,
      discoverSkills: discoverSkillsMock,
      importDiscoveredSkill: vi.fn(),
    })
    setupStoreMock(useAppStore, store)
  })

  it('highlights the skill whose edit panel is open', () => {
    setupStoreMock(useAppStore, createMockAppStore({
      skills: [LIBRARY_SKILL],
      discoveredSkills: [],
      discoveringSkills: false,
      editingSkillId: LIBRARY_SKILL.id,
      showSkillPanel: true,
    }))
    render(<SkillsPane />)

    const row = screen.getByText(LIBRARY_SKILL.name).closest('[aria-current]')
    expect(row).toHaveAttribute('aria-current', 'true')
    expect(row).toHaveClass('border-nexy-accent', 'bg-nexy-recessed')
  })

  it('distinguishes the empty Nexy library from skills found on disk', async () => {
    const user = userEvent.setup()
    render(<SkillsPane />)

    expect(screen.getByText('0 in library')).toBeInTheDocument()
    expect(discoverSkillsMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /discover skills on disk/i }))

    expect(screen.getByRole('dialog', { name: 'Discover skills' })).toBeInTheDocument()
    expect(discoverSkillsMock).toHaveBeenCalledWith(undefined)
    expect(screen.getByText('1 found on disk')).toBeInTheDocument()
  })

  it('explains that readable CLI skill metadata will be normalized on import', async () => {
    const user = userEvent.setup()
    render(<SkillsPane />)
    await user.click(screen.getByRole('button', { name: /discover skills on disk/i }))

    expect(screen.getByRole('button', { name: 'Import swap-tls-certificate' })).toBeEnabled()
    expect(screen.getByText(/description is required/i)).toBeInTheDocument()
  })

  it('searches and filters discovered skills without changing the library search', async () => {
    const user = userEvent.setup()
    setupStoreMock(useAppStore, createMockAppStore({
      skills: [],
      discoveredSkills: DISCOVERIES,
      discoveringSkills: false,
      discoverSkills: discoverSkillsMock,
      importDiscoveredSkill: vi.fn(),
    }))
    render(<SkillsPane />)
    await user.click(screen.getByRole('button', { name: /discover skills on disk/i }))

    expect(screen.getByText('3 found on disk')).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'Search discovered skills' }), 'beta')
    expect(screen.getByText('1 of 3 shown')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(screen.queryByText('alpha')).not.toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox', { name: 'Search discovered skills' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter discovered skill sources' }), 'codex')
    expect(screen.getByText('1 of 3 shown')).toBeInTheDocument()
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.queryByText('beta')).not.toBeInTheDocument()
  })

  it('sorts discovered skills by name and status', async () => {
    const user = userEvent.setup()
    setupStoreMock(useAppStore, createMockAppStore({
      skills: [],
      discoveredSkills: DISCOVERIES,
      discoveringSkills: false,
      discoverSkills: discoverSkillsMock,
      importDiscoveredSkill: vi.fn(),
    }))
    render(<SkillsPane />)
    await user.click(screen.getByRole('button', { name: /discover skills on disk/i }))

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort discovered skills' }), 'name-desc')
    expect(screen.getAllByText(/^(swap-tls-certificate|beta|alpha)$/).map((element) => element.textContent)).toEqual([
      'swap-tls-certificate',
      'beta',
      'alpha',
    ])

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort discovered skills' }), 'status')
    expect(screen.getAllByText(/^(swap-tls-certificate|beta|alpha)$/).map((element) => element.textContent)).toEqual([
      'swap-tls-certificate',
      'beta',
      'alpha',
    ])
  })
})
