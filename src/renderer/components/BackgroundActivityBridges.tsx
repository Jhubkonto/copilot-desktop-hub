import { useEffect } from 'react'
import { useAppStore } from '../store/app-store'
import type { BackgroundActivityKind } from '../store/types'

interface BackgroundActivityStoreApi {
  upsertBackgroundActivity?: (activity: {
    id: string
    kind: BackgroundActivityKind
    label: string
    projectId?: string
  }) => void
  removeBackgroundActivity?: (id: string) => void
}

const activityLabels: Record<BackgroundActivityKind, string> = {
  'project-generator': 'Generating project…',
  'agent-generator': 'Generating agent…',
  'skill-generator': 'Generating skill…',
  'scheduler-generator': 'Generating scheduled task…',
  'manual-workflow-generator': 'Generating workflow…',
}

function startActivity(kind: BackgroundActivityKind, projectId?: string) {
  const id = kind === 'manual-workflow-generator' && projectId
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
  const id = kind === 'manual-workflow-generator' && projectId
    ? `${kind}:${projectId}`
    : kind
  const state = (useAppStore as unknown as { getState?: () => BackgroundActivityStoreApi }).getState?.()
  state?.removeBackgroundActivity?.(id)
}

export function trackManualWorkflowGeneration(projectId: string) {
  startActivity('manual-workflow-generator', projectId)
}

export function clearManualWorkflowGeneration(projectId: string) {
  stopActivity('manual-workflow-generator', projectId)
}

export function BackgroundActivityBridges() {
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
