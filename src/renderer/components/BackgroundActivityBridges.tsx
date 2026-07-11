import { useEffect } from 'react'
import { useAppStore } from '../store/app-store'
import type { BackgroundActivity, BackgroundActivityKind } from '../store/types'

interface BackgroundActivityStoreApi {
  upsertBackgroundActivity?: (activity: {
    id: string
    kind: BackgroundActivityKind
    label: string
    projectId?: string
  }) => void
  removeBackgroundActivity?: (id: string) => void
  applyActivitySnapshot?: (snapshot: BackgroundActivity[]) => void
}

const activityLabels: Record<BackgroundActivityKind, string> = {
  'project-generator': 'Generating project…',
  'agent-generator': 'Generating agent…',
  'skill-generator': 'Generating skill…',
  'scheduler-generator': 'Generating scheduled task…',
  'automated-workflow-generator': 'Generating workflow…',
  'automated-workflow-run': 'Running workflow step…',
  'debrief-generation': 'Generating debrief…',
  'quiz-generation': 'Generating quiz…',
  chat: 'Assistant is responding…',
  build: 'Building…',
  'remote-edit': 'Investigating code change…',
  orchestration: 'Delegating to agent…',
}

function startActivity(kind: BackgroundActivityKind, projectId?: string) {
  const id = kind === 'automated-workflow-generator' && projectId
    ? `${kind}:${projectId}`
    : kind
  const state = (useAppStore as unknown as { getState?: () => BackgroundActivityStoreApi }).getState?.()
  state?.upsertBackgroundActivity?.({
    id,
    kind,
    label: activityLabels[kind],
    projectId,
  })
}

function stopActivity(kind: BackgroundActivityKind, projectId?: string) {
  const id = kind === 'automated-workflow-generator' && projectId
    ? `${kind}:${projectId}`
    : kind
  const state = (useAppStore as unknown as { getState?: () => BackgroundActivityStoreApi }).getState?.()
  state?.removeBackgroundActivity?.(id)
}

// projectId is nullable — a project-less (standalone) workflow generation still needs an
// activity entry, keyed to match the main process's own id for this case exactly
// (`automated-workflow-generator:${projectId ?? 'global'}`, see automated-workflow-generator.ts)
// so the locally-optimistic entry created here reconciles cleanly against the server snapshot
// instead of momentarily showing as two separate entries.
export function trackAutomatedWorkflowGeneration(projectId: string | null) {
  startActivity('automated-workflow-generator', projectId ?? 'global')
}

export function clearAutomatedWorkflowGeneration(projectId: string | null) {
  stopActivity('automated-workflow-generator', projectId ?? 'global')
}

export function BackgroundActivityBridges() {
  // Cross-device activity feed — hydrates from the main process on mount, then stays live via
  // push. Server-authoritative for every kind it tracks (see src/main/activity-tracker.ts);
  // reconciled against local-optimistic entries in applyActivitySnapshot.
  useEffect(() => {
    const state = (useAppStore as unknown as { getState?: () => BackgroundActivityStoreApi }).getState?.()
    window.api.getActivityList().then((snapshot) => {
      state?.applyActivitySnapshot?.(snapshot)
    }).catch(() => {})
    const off = window.api.onActivityChanged((snapshot) => {
      state?.applyActivitySnapshot?.(snapshot)
    })
    return off
  }, [])

  useEffect(() => {
    const offProjectToken = window.api.onProjectGeneratorToken(() => {
      startActivity('project-generator')
    })
    const offProjectDone = window.api.onProjectGeneratorDone(() => {
      stopActivity('project-generator')
    })
    const offProjectError = window.api.onProjectGeneratorError?.(() => {
      stopActivity('project-generator')
    }) ?? (() => {})

    const offAgentToken = window.api.onAgentGeneratorToken(() => {
      startActivity('agent-generator')
    })
    const offAgentDone = window.api.onAgentGeneratorDone(() => {
      stopActivity('agent-generator')
    })
    const offAgentError = window.api.onAgentGeneratorError?.(() => {
      stopActivity('agent-generator')
    }) ?? (() => {})

    const offSkillToken = window.api.onSkillGeneratorToken(() => {
      startActivity('skill-generator')
    })
    const offSkillDone = window.api.onSkillGeneratorDone(() => {
      stopActivity('skill-generator')
    })
    const offSkillError = window.api.onSkillGeneratorError?.(() => {
      stopActivity('skill-generator')
    }) ?? (() => {})

    const offScheduleToken = window.api.onScheduleGeneratorToken(() => {
      startActivity('scheduler-generator')
    })
    const offScheduleDone = window.api.onScheduleGeneratorDone(() => {
      stopActivity('scheduler-generator')
    })
    const offScheduleError = window.api.onScheduleGeneratorError?.(() => {
      stopActivity('scheduler-generator')
    }) ?? (() => {})

    return () => {
      offProjectToken()
      offProjectDone()
      offProjectError()
      offAgentToken()
      offAgentDone()
      offAgentError()
      offSkillToken()
      offSkillDone()
      offSkillError()
      offScheduleToken()
      offScheduleDone()
      offScheduleError()
    }
  }, [])

  return null
}
