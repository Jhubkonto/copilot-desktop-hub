import { describe, expect, it } from 'vitest'
import { extractManualWorkflowSpec, normalizeManualWorkflowSpec } from '../manual-workflow-generator'

describe('manual workflow generator', () => {
  it('extracts a manual workflow spec from tagged assistant text', () => {
    const spec = extractManualWorkflowSpec(`Plan ready.
<manual-workflow-spec>
{
  "title": "Launch workflow",
  "goalSummary": "Ship the feature safely",
  "assumptions": ["Codebase already builds locally"],
  "steps": [
    {
      "id": "step-1",
      "title": "Assess current implementation",
      "summary": "Review constraints and current state",
      "agentId": "agent-1",
      "agentName": "Planner",
      "prompt": "Review the current implementation and list the main risks.",
      "expectedOutput": "Risk list"
    }
  ]
}
</manual-workflow-spec>`)

    expect(spec).toEqual({
      title: 'Launch workflow',
      goalSummary: 'Ship the feature safely',
      assumptions: ['Codebase already builds locally'],
      steps: [
        {
          id: 'step-1',
          title: 'Assess current implementation',
          summary: 'Review constraints and current state',
          agentId: 'agent-1',
          agentName: 'Planner',
          prompt: 'Review the current implementation and list the main risks.',
          expectedOutput: 'Risk list',
        },
      ],
    })
  })

  it('normalizes missing optional fields and preserves valid dependency ids', () => {
    const spec = normalizeManualWorkflowSpec({
      title: '',
      goalSummary: '',
      assumptions: ['One', '', 4],
      steps: [
        {
          prompt: 'Do the first thing',
          dependsOnStepIds: [],
        },
        {
          id: 'ship',
          title: 'Ship it',
          prompt: 'Prepare the rollout',
          expectedOutput: 'Release notes',
          dependsOnStepIds: ['step-1', '', 3],
        },
      ],
    })

    expect(spec.title).toBe('Manual workflow')
    expect(spec.assumptions).toEqual(['One'])
    expect(spec.steps).toEqual([
      {
        id: 'step-1',
        title: 'Step 1',
        summary: '',
        agentId: undefined,
        agentName: undefined,
        prompt: 'Do the first thing',
        expectedOutput: '',
        dependsOnStepIds: undefined,
      },
      {
        id: 'ship',
        title: 'Ship it',
        summary: '',
        agentId: undefined,
        agentName: undefined,
        prompt: 'Prepare the rollout',
        expectedOutput: 'Release notes',
        dependsOnStepIds: ['step-1'],
      },
    ])
  })

  it('rejects specs without at least one valid prompt-bearing step', () => {
    expect(() => normalizeManualWorkflowSpec({
      title: 'Broken workflow',
      steps: [{ title: 'Empty prompt', prompt: '' }],
    })).toThrow('Manual workflow requires at least one step')
  })

  it('returns null for invalid tagged JSON', () => {
    expect(extractManualWorkflowSpec('<manual-workflow-spec>{ nope }</manual-workflow-spec>')).toBeNull()
  })
})
