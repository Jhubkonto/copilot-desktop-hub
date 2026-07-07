import type { ManualWorkflowSpec, ManualWorkflowStep } from '../shared/types'

export type WorkflowRunStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
export type WorkflowRunStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

export interface WorkflowRunStep extends ManualWorkflowStep {
  sortOrder: number
  status: WorkflowRunStepStatus
  attempt: number
  output: string
  error: string | null
  startedAt: number | null
  completedAt: number | null
}

export interface WorkflowRunSnapshot {
  id: string
  projectId: string
  title: string
  goalSummary: string
  assumptions: string[]
  model: string | null
  status: WorkflowRunStatus
  currentStepId: string | null
  error: string | null
  createdAt: number
  updatedAt: number
  startedAt: number | null
  completedAt: number | null
  steps: WorkflowRunStep[]
}

export interface WorkflowStepRunnerInput {
  run: WorkflowRunSnapshot
  step: WorkflowRunStep
  prompt: string
  model: string | null
}

export type WorkflowStepRunner = (input: WorkflowStepRunnerInput) => Promise<string>

const DEFAULT_CONTEXT_LIMIT = 6000

function dependencyIds(step: ManualWorkflowStep): string[] {
  return Array.isArray(step.dependsOnStepIds)
    ? step.dependsOnStepIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
}

function cloneRun(run: WorkflowRunSnapshot): WorkflowRunSnapshot {
  return {
    ...run,
    assumptions: [...run.assumptions],
    steps: run.steps.map((step) => ({ ...step, dependsOnStepIds: step.dependsOnStepIds ? [...step.dependsOnStepIds] : undefined })),
  }
}

export function orderWorkflowSteps(steps: ManualWorkflowStep[]): ManualWorkflowStep[] {
  const byId = new Map<string, ManualWorkflowStep>()
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const step of steps) {
    if (!step.id) throw new Error('Workflow step is missing an id')
    if (byId.has(step.id)) throw new Error(`Duplicate workflow step id: ${step.id}`)
    byId.set(step.id, step)
    inDegree.set(step.id, 0)
    dependents.set(step.id, [])
  }

  for (const step of steps) {
    for (const depId of dependencyIds(step)) {
      if (!byId.has(depId)) {
        throw new Error(`Workflow step "${step.id}" depends on missing step "${depId}"`)
      }
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1)
      dependents.get(depId)?.push(step.id)
    }
  }

  const queue = steps.filter((step) => (inDegree.get(step.id) ?? 0) === 0).map((step) => step.id)
  const ordered: ManualWorkflowStep[] = []

  while (queue.length > 0) {
    const id = queue.shift() as string
    const step = byId.get(id)
    if (!step) continue
    ordered.push(step)

    for (const childId of dependents.get(id) ?? []) {
      const nextDegree = (inDegree.get(childId) ?? 0) - 1
      inDegree.set(childId, nextDegree)
      if (nextDegree === 0) queue.push(childId)
    }
  }

  if (ordered.length !== steps.length) {
    throw new Error('Workflow contains a dependency cycle')
  }

  return ordered
}

function truncateContext(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit).trimEnd()}\n\n[context truncated]`
}

export function weaveStepPrompt(
  step: ManualWorkflowStep,
  completedStepsById: Map<string, Pick<ManualWorkflowStep, 'id' | 'title'> & { output: string }>,
  contextLimit = DEFAULT_CONTEXT_LIMIT,
): string {
  const deps = dependencyIds(step)
  if (deps.length === 0) return step.prompt

  const contextBlocks = deps.map((depId) => {
    const dep = completedStepsById.get(depId)
    if (!dep) {
      throw new Error(`Workflow step "${step.id}" cannot start before dependency "${depId}" completes`)
    }
    return [
      `## Context from step '${dep.title}'`,
      truncateContext(dep.output, contextLimit),
    ].join('\n\n')
  })

  return [
    ...contextBlocks,
    '## Your task:',
    step.prompt,
  ].join('\n\n')
}

export function createWorkflowRunSnapshot(input: {
  id: string
  projectId: string
  spec: ManualWorkflowSpec
  model?: string | null
  now?: number
}): WorkflowRunSnapshot {
  const now = input.now ?? Date.now()
  const ordered = orderWorkflowSteps(input.spec.steps)
  return {
    id: input.id,
    projectId: input.projectId,
    title: input.spec.title,
    goalSummary: input.spec.goalSummary,
    assumptions: [...input.spec.assumptions],
    model: input.model ?? null,
    status: 'pending',
    currentStepId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    steps: ordered.map((step, index) => ({
      ...step,
      dependsOnStepIds: step.dependsOnStepIds ? [...step.dependsOnStepIds] : undefined,
      sortOrder: index,
      status: 'pending',
      attempt: 0,
      output: '',
      error: null,
      startedAt: null,
      completedAt: null,
    })),
  }
}

export async function executeWorkflowRun(
  initialRun: WorkflowRunSnapshot,
  runner: WorkflowStepRunner,
  now: () => number = () => Date.now(),
): Promise<WorkflowRunSnapshot> {
  const run = cloneRun(initialRun)
  run.status = 'running'
  run.error = null
  run.startedAt = run.startedAt ?? now()
  run.updatedAt = run.startedAt

  const completed = new Map<string, Pick<ManualWorkflowStep, 'id' | 'title'> & { output: string }>()
  for (const doneStep of run.steps.filter((step) => step.status === 'done')) {
    completed.set(doneStep.id, { id: doneStep.id, title: doneStep.title, output: doneStep.output })
  }

  for (const step of run.steps) {
    if (step.status === 'done') continue
    if (step.status === 'cancelled') {
      run.status = 'cancelled'
      run.currentStepId = null
      run.completedAt = now()
      run.updatedAt = run.completedAt
      return run
    }

    const startedAt = now()
    run.currentStepId = step.id
    run.updatedAt = startedAt
    run.steps = run.steps.map((candidate) =>
      candidate.id === step.id
        ? { ...candidate, status: 'running', error: null, startedAt, completedAt: null }
        : candidate
    )
    const activeStep = run.steps.find((candidate) => candidate.id === step.id)
    if (!activeStep) throw new Error(`Workflow step "${step.id}" disappeared during execution`)

    try {
      const prompt = weaveStepPrompt(activeStep, completed)
      const output = await runner({ run: cloneRun(run), step: activeStep, prompt, model: run.model })
      const completedAt = now()
      const cleanOutput = output.trim()
      run.steps = run.steps.map((candidate) =>
        candidate.id === step.id
          ? { ...candidate, status: 'done', output: cleanOutput, error: null, completedAt }
          : candidate
      )
      completed.set(step.id, { id: step.id, title: step.title, output: cleanOutput })
      run.updatedAt = completedAt
    } catch (error) {
      const completedAt = now()
      const message = error instanceof Error ? error.message : String(error)
      run.steps = run.steps.map((candidate) =>
        candidate.id === step.id
          ? { ...candidate, status: 'failed', error: message, completedAt }
          : candidate
      )
      run.status = 'failed'
      run.error = message
      run.currentStepId = null
      run.completedAt = completedAt
      run.updatedAt = completedAt
      return run
    }
  }

  const completedAt = now()
  run.status = 'done'
  run.currentStepId = null
  run.completedAt = completedAt
  run.updatedAt = completedAt
  return run
}

export function getDownstreamWorkflowStepIds(steps: ManualWorkflowStep[], stepId: string): Set<string> {
  const downstream = new Set<string>([stepId])
  let changed = true
  while (changed) {
    changed = false
    for (const step of steps) {
      if (downstream.has(step.id)) continue
      if (dependencyIds(step).some((depId) => downstream.has(depId))) {
        downstream.add(step.id)
        changed = true
      }
    }
  }
  return downstream
}

export function resetWorkflowStepAndDependents(run: WorkflowRunSnapshot, stepId: string, now = Date.now()): WorkflowRunSnapshot {
  if (!run.steps.some((step) => step.id === stepId)) {
    throw new Error(`Workflow step "${stepId}" was not found`)
  }
  const resetIds = getDownstreamWorkflowStepIds(run.steps, stepId)
  return {
    ...cloneRun(run),
    status: 'pending',
    currentStepId: null,
    error: null,
    updatedAt: now,
    completedAt: null,
    steps: run.steps.map((step) =>
      resetIds.has(step.id)
        ? {
            ...step,
            status: 'pending',
            attempt: step.attempt + 1,
            output: '',
            error: null,
            startedAt: null,
            completedAt: null,
          }
        : { ...step }
    ),
  }
}
