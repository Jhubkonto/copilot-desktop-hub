import type { ReactNode } from 'react'
import type { ErrorReportEntry } from '@shared/types'
import { MarkdownRenderer } from './MarkdownRenderer'

// Removes the YAML front matter block investigator.ts asks the model to emit
// (confidence/root_cause/affected_files — already available as structured report fields, shown
// via PlanCard instead). The model doesn't always follow the "---delimited, at the very
// start" instruction exactly, so this mirrors the same two forms the backend parser
// (extractFrontMatterCandidates in investigator.ts) already tolerates: a `---`-delimited block
// (anchored to the start, per the prompt) or a ```yaml fenced block (which can appear anywhere).
export function stripFrontMatter(markdown: string): string {
  return markdown
    .replace(/^---\n[\s\S]*?\n---\s*\n?/, '')
    .replace(/```ya?ml\s*\n[\s\S]*?```\s*\n?/i, '')
    .trim()
}

export function parseAffectedFiles(report: ErrorReportEntry): string[] {
  try { return JSON.parse(report.investigation_affected_files || '[]') } catch { return [] }
}

// Legacy reports persisted a qualitative high/medium/low confidence before the model was asked
// for a 0-100 score — kept so older reports still render with a sensible color.
const LEGACY_CONFIDENCE_STYLES: Record<string, string> = {
  high: 'border-nexy-success text-nexy-success',
  medium: 'border-nexy-warning text-nexy-warning',
  low: 'border-nexy-error text-nexy-error',
}

// Pastel red -> amber -> green, keyed by the lower bound of each 20-point band.
const CONFIDENCE_SCORE_STYLES: [number, string][] = [
  [80, 'border-nexy-success text-nexy-success'],
  [60, 'border-nexy-success text-nexy-success'],
  [40, 'border-nexy-warning text-nexy-warning'],
  [20, 'border-nexy-warning text-nexy-warning'],
  [0, 'border-nexy-error text-nexy-error'],
]

function confidenceBadge(rawConfidence: string): { label: string; className: string } | null {
  const trimmed = rawConfidence.trim()
  if (!trimmed || ['unknown', 'none'].includes(trimmed.toLowerCase())) return null

  const numeric = Number.parseInt(trimmed, 10)
  if (!Number.isNaN(numeric) && /^\d+%?$/.test(trimmed)) {
    const score = Math.max(0, Math.min(100, numeric))
    const className = CONFIDENCE_SCORE_STYLES.find(([min]) => score >= min)?.[1] ?? CONFIDENCE_SCORE_STYLES[CONFIDENCE_SCORE_STYLES.length - 1][1]
    return { label: `${score}% confidence`, className }
  }

  const legacy = trimmed.toLowerCase()
  if (legacy in LEGACY_CONFIDENCE_STYLES) {
    return { label: `${legacy} confidence`, className: LEGACY_CONFIDENCE_STYLES[legacy] }
  }
  return { label: `${trimmed} confidence`, className: 'border-nexy-border text-nexy-muted' }
}

/**
 * Single card for a plan: confidence badge, root cause, and affected files as a compact metadata
 * strip up top (when available), then the rendered markdown body — one bordered container, with
 * a hairline divider only between the metadata strip and the body, not a second boxed section.
 */
export function PlanCard({
  report,
  affectedFiles,
  body,
  showSummary = true,
  className,
  bodyClassName,
  actions,
}: {
  report: ErrorReportEntry
  affectedFiles: string[]
  body: string
  // The live stream during an active run hasn't been through persistResult() yet, so
  // report.investigation_confidence/investigation_root_cause would still reflect the *previous*
  // persisted plan — pass false while streaming to avoid attaching stale metadata to new output.
  showSummary?: boolean
  className?: string
  bodyClassName?: string
  actions?: ReactNode
}) {
  const rootCause = report.investigation_root_cause
  const badge = report.investigation_confidence ? confidenceBadge(report.investigation_confidence) : null
  const hasRootCause = Boolean(rootCause && rootCause.toLowerCase() !== 'unknown')
  const revisionNotes = showSummary ? report.investigation_revision_notes?.trim() : null
  const hasSummary = showSummary && (Boolean(badge) || hasRootCause || affectedFiles.length > 0)

  return (
    <div className={className ?? 'relative rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised p-3 shadow-nexy'}>
      {actions && <div className="absolute right-2 top-2">{actions}</div>}
      {hasSummary && (
        <div className={`mb-3 space-y-2 border-b-2 border-nexy-border pb-3 ${actions ? 'pr-8' : ''}`}>
          {badge && (
            <span className={`nexy-font-status inline-block shrink-0 rounded-nexy-sm border bg-nexy-recessed px-2 py-0.5 ${badge.className}`}>
              {badge.label}
            </span>
          )}
          {hasRootCause && (
            <p className="text-sm text-nexy-text">{rootCause}</p>
          )}
          {affectedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {affectedFiles.map((file) => (
                <span key={file} className="rounded-nexy-sm border border-nexy-border bg-nexy-recessed px-1.5 py-0.5 font-mono text-[10px] text-nexy-muted">
                  {file}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {revisionNotes && (
        <div className="mb-3 rounded-nexy-sm border-2 border-nexy-info bg-nexy-recessed px-2.5 py-2">
          <p className="nexy-font-status text-nexy-info">Revised with</p>
          <p className="mt-0.5 text-xs text-nexy-text">{revisionNotes}</p>
        </div>
      )}
      <div className={bodyClassName}>
        <MarkdownRenderer content={body} />
      </div>
    </div>
  )
}

/** Structured summary + cleaned markdown body for the currently persisted plan, used as the "View current plan" side of RevisePlanControl. Returns null if there's no plan yet. */
export function PlanPreview({ report }: { report: ErrorReportEntry }) {
  if (!report.investigation_markdown) return null
  const affectedFiles = parseAffectedFiles(report)
  const body = stripFrontMatter(report.investigation_markdown)
  return <PlanCard report={report} affectedFiles={affectedFiles} body={body} />
}
