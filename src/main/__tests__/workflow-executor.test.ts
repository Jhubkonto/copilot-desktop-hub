import { describe, expect, it, vi } from 'vitest'
import type { ManualWorkflowSpec } from '../../shared/types'
import {
  createWorkflowRunSnapshot,
  executeWorkflowRun,
  orderWorkflowSteps,
  resetWorkflowStepAndDependents,
  weaveStepPrompt,
} from '../workflow-executor'

function workflowSpec(): ManualWorkflowSpec {
  return {
    title: 'Ship feature',
    goalSummary: 'Prepare and ship a feature',
    assumptions: [],
    steps: [
      {
        id: 'plan',
        title: 'Plan',
        summary: '',
        prompt: 'Create a plan.',
        expectedOutput: 'Plan',
      },
      {
        id: 'build',
        title: 'Build',
        summary: '',
        prompt: 'Implement the plan.',
        expectedOutput: 'Implementation',
        dependsOnStepIds: ['plan'],
      },
      {
        id: 'verify',
        title: 'Verify',
        summary: '',
        prompt: 'Verify the implementation.',
        expectedOutput: 'Verification',
        dependsOnStepIds: ['build'],
      },
      {
        id: 'announce',
        title: 'Announce',
        summary: '',
        prompt: 'Draft release notes.',
        expectedOutput: 'Release notes',
      },
    ],
  }
}

describe('workflow-executor', () => {
  it('topologically orders dependency steps while preserving listed order for independent steps', () => {
    const ordered = orderWorkflowSteps([
      workflowSpec().steps[1],
      workflowSpec().steps[0],
      workflowSpec().steps[3],
      workflowSpec().steps[2],
    ])

    expect(ordered.map((step) => step.id)).toEqual(['plan', 'announce', 'build', 'verify'])
  })

  it('rejects dependency cycles before execution', () => {
    expect(() => orderWorkflowSteps([
      {
        id: 'a',
        title: 'A',
        summary: '',
        prompt: 'A',
        expectedOutput: '',
        dependsOnStepIds: ['b'],
      },
      {
        id: 'b',
        title: 'B',
        summary: '',
        prompt: 'B',
        expectedOutput: '',
        dependsOnStepIds: ['a'],
      },
    ])).toThrow('dependency cycle')
  })

  it('weaves dependency outputs into a dependent step prompt', () => {
    const step = workflowSpec().steps[1]
    const prompt = weaveStepPrompt(
      step,
      new Map([
        ['plan', { id: 'plan', title: 'Plan', output: 'Use approach A.' }],
      ]),
    )

    expect(prompt).toContain("## Context from step 'Plan'")
    expect(prompt).toContain('Use approach A.')
    expect(prompt).toContain('## Your task:')
    expect(prompt).toContain('Implement the plan.')
  })

  it('executes steps sequentially and feeds dependency context to downstream steps', async () => {
    const run = createWorkflowRunSnapshot({
      id: 'run-1',
      projectId: 'project-1',
      spec: workflowSpec(),
      model: 'gpt-test',
      now: 100,
    })
    const prompts: string[] = []

    const result = await executeWorkflowRun(
      run,
      vi.fn(async ({ step, prompt }) => {
        prompts.push(prompt)
        return `output:${step.id}`
      }),
      (() => {
        let current = 100
        return () => ++current
      })(),
    )

    expect(result.status).toBe('done')
    expect(result.steps.map((step) => [step.id, step.status, step.output])).toEqual([
      ['plan', 'done', 'output:plan'],
      ['announce', 'done', 'output:announce'],
      ['build', 'done', 'output:build'],
      ['verify', 'done', 'output:verify'],
    ])
    expect(prompts[2]).toContain("## Context from step 'Plan'")
    expect(prompts[2]).toContain('output:plan')
    expect(prompts[3]).toContain("## Context from step 'Build'")
    expect(prompts[3]).toContain('output:build')
  })

  it('halts on step failure and leaves downstream steps pending', async () => {
    const run = createWorkflowRunSnapshot({
      id: 'run-1',
      projectId: 'project-1',
      spec: workflowSpec(),
    })

    const result = await executeWorkflowRun(run, async ({ step }) => {
      if (step.id === 'build') throw new Error('bad model')
      return `output:${step.id}`
    })

    expect(result.status).toBe('failed')
    expect(result.error).toBe('bad model')
    expect(result.steps.find((step) => step.id === 'build')?.status).toBe('failed')
    expect(result.steps.find((step) => step.id === 'verify')?.status).toBe('pending')
  })

  it('resets only a failed step and its transitive dependents for retry', async () => {
    const run = createWorkflowRunSnapshot({
      id: 'run-1',
      projectId: 'project-1',
      spec: workflowSpec(),
      now: 100,
    })
    const failed = await executeWorkflowRun(run, async ({ step }) => {
      if (step.id === 'build') throw new Error('bad model')
      return `output:${step.id}`
    })

    const reset = resetWorkflowStepAndDependents(failed, 'build', 500)

    expect(reset.status).toBe('pending')
    expect(reset.steps.find((step) => step.id === 'plan')).toEqual(
      expect.objectContaining({ status: 'done', output: 'output:plan', attempt: 0 }),
    )
    expect(reset.steps.find((step) => step.id === 'announce')).toEqual(
      expect.objectContaining({ status: 'done', output: 'output:announce', attempt: 0 }),
    )
    expect(reset.steps.find((step) => step.id === 'build')).toEqual(
      expect.objectContaining({ status: 'pending', output: '', error: null, attempt: 1 }),
    )
    expect(reset.steps.find((step) => step.id === 'verify')).toEqual(
      expect.objectContaining({ status: 'pending', output: '', error: null, attempt: 1 }),
    )
  })
})
