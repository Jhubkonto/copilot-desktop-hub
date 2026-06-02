import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import {
  createAgentSlice,
  type AgentSlice
} from './slices/agentSlice'
import {
  createAuthSlice,
  type AuthSlice
} from './slices/authSlice'
import {
  createConversationSlice,
  type ConversationSlice
} from './slices/conversationSlice'
import {
  createProjectSlice,
  type ProjectSlice
} from './slices/projectSlice'
import {
  createUiSlice,
  type UiSlice
} from './slices/uiSlice'

export type {
  ActiveSectionPane,
  AuthState,
  Conversation,
  DeleteAgentImpact,
  Milestone,
  Project,
  ProjectAgent,
  ProjectConfig,
  ProjectOrchestrationConfig,
  ProjectVariable,
  ScopeRule,
  Theme,
  Toast,
  ToolApprovalRequest
} from './types'
export { DEFAULT_PROJECT_CONFIG } from './types'

export type AppState =
  & AuthSlice
  & ConversationSlice
  & ProjectSlice
  & AgentSlice
  & UiSlice
  & {
    hydrate: () => Promise<void>
  }

export const useAppStore = create<AppState>()(
  immer((set, get, store) => ({
    ...createAuthSlice(set, get, store),
    ...createConversationSlice(set, get, store),
    ...createProjectSlice(set, get, store),
    ...createAgentSlice(set, get, store),
    ...createUiSlice(set, get, store),

    hydrate: async () => {
      try {
        const savedTheme = await window.api.getTheme()
        const t = savedTheme === 'light' ? 'light' : 'dark'
        get().setTheme(t)
      } catch {
        /* use default */
      }

      const [, onboardingVal] = await Promise.all([
        get().checkAuth(),
        window.api.getSetting('onboarding_complete').catch(() => null),
      ])

      if (onboardingVal !== 'true') {
        const { cliInstalled, authenticated } = get().authState
        if (cliInstalled || authenticated) {
          // Provider already available — silently mark onboarding complete
          try {
            await window.api.setSetting('onboarding_complete', 'true')
          } catch {
            // Persistence failed; don't block the user
          }
        } else {
          // Nothing configured — guide the user through setup
          set((s) => { s.showOnboarding = true })
        }
      }

      await Promise.all([
        get().loadConversations(),
        get().loadAgents(),
        get().loadProjects(),
        window.api
          .listModelCatalog()
          .then((models) => {
            if (models.length > 0) {
              set((s) => {
                s.catalogModels = models
              })
            }
          })
          .catch(() => {}),
        window.api
          .getSetting('default_model')
          .then((val) => {
            if (typeof val === 'string' && val) {
              get().setGlobalDefaultModel(val)
            }
          })
          .catch(() => {})
      ])
    }
  }))
)
