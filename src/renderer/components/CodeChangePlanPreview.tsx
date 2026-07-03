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
  high: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  low: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

// Pastel red -> amber -> green, keyed by the lower bound of each 20-point band.
const CONFIDENCE_SCORE_STYLES: [number, string][] = [
  [80, 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'],
  [60, 'bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300'],
  [40, 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'],
  [20, 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300'],
  [0, 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'],
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
  return { label: `${trimmed} confidence`, className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' }
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
    <div className={className ?? 'relative rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900'}>
      {actions && <div className="absolute right-2 top-2">{actions}</div>}
      {hasSummary && (
        <div className={`mb-3 space-y-2 border-b border-gray-100 pb-3 dark:border-gray-800 ${actions ? 'pr-8' : ''}`}>
          {badge && (
            <span className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}>
              {badge.label}
            </span>
          )}
          {hasRootCause && (
            <p className="text-sm text-gray-700 dark:text-gray-300">{rootCause}</p>
          )}
          {affectedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {affectedFiles.map((file) => (
                <span key={file} className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400">
                  {file}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {revisionNotes && (
        <div className="mb-3 rounded-md border border-blue-100 bg-blue-50 px-2.5 py-2 dark:border-blue-900/50 dark:bg-blue-950/20">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">Revised with</p>
          <p className="mt-0.5 text-xs text-blue-900 dark:text-blue-200">{revisionNotes}</p>
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
