import { useState } from 'react'
import { ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2 } from 'lucide-react'

export interface TeamActivityStep {
  stepId: string
  agentId: string
  agentName: string
  agentIcon: string
  task: string
  status: 'delegating' | 'done' | 'error'
  result?: string
  durationMs?: number
}

interface TeamActivityBlockProps {
  steps: TeamActivityStep[]
  isLive?: boolean
}

export function TeamActivityBlock({ steps, isLive = false }: TeamActivityBlockProps) {
  const [expanded, setExpanded] = useState(isLive)
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }

  const doneCount = steps.filter((s) => s.status === 'done').length
  const hasError = steps.some((s) => s.status === 'error')
  const allDone = steps.length > 0 && steps.every((s) => s.status !== 'delegating')

  return (
    <div className="team-activity-block">
      <button
        className="team-activity-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title="Team delegation activity"
      >
        {expanded ? (
          <ChevronDown size={14} className="team-activity-chevron" />
        ) : (
          <ChevronRight size={14} className="team-activity-chevron" />
        )}
        <span className="team-activity-icon">🤝</span>
        <span className="team-activity-title">
          Team Activity
        </span>
        <span className="team-activity-summary">
          {!allDone && isLive ? (
            <><Loader2 size={12} className="spin" /> Working...</>
          ) : hasError ? (
            <><XCircle size={12} className="error" /> {doneCount}/{steps.length} done</>
          ) : (
            <><CheckCircle size={12} className="success" /> {doneCount} step{doneCount !== 1 ? 's' : ''}</>
          )}
        </span>
      </button>

      {expanded && (
        <div className="team-activity-steps">
          {steps.map((step) => (
            <div key={step.stepId} className={`team-activity-step status-${step.status}`}>
              <button
                className="team-activity-step-header"
                onClick={() => toggleStep(step.stepId)}
                disabled={!step.result}
                title={step.result ? 'Click to expand result' : undefined}
              >
                <span className="step-status-icon">
                  {step.status === 'delegating' && <Loader2 size={12} className="spin" />}
                  {step.status === 'done' && <CheckCircle size={12} className="success" />}
                  {step.status === 'error' && <XCircle size={12} className="error" />}
                </span>
                <span className="step-agent-icon">{step.agentIcon}</span>
                <span className="step-agent-name">{step.agentName}</span>
                <span className="step-separator">→</span>
                <span className="step-task">{step.task}</span>
                {step.durationMs !== undefined && (
                  <span className="step-duration">
                    {step.durationMs < 1000
                      ? `${step.durationMs}ms`
                      : `${(step.durationMs / 1000).toFixed(1)}s`}
                  </span>
                )}
                {step.result && (
                  expandedSteps.has(step.stepId)
                    ? <ChevronDown size={12} />
                    : <ChevronRight size={12} />
                )}
              </button>

              {expandedSteps.has(step.stepId) && step.result && (
                <div className="step-result">
                  <pre>{step.result}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
