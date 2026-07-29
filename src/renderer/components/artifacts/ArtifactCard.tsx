import { useState, useEffect } from 'react'
import { Package, PackageX, Copy, CheckCircle, AlertCircle, ChevronDown, ChevronUp, ListChecks } from 'lucide-react'

import type { ArtifactRow, ArtifactVersion } from '@shared/types'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { DebriefArtifactCard } from './DebriefArtifactCard'
import { QuizArtifactCard } from './QuizArtifactCard'
import { TeachbackArtifactCard } from './TeachbackArtifactCard'
import { ArtifactKindBadge, artifactDisplayTitle, artifactKindLabel } from './artifactDisplay'

const SUPPORTED_EXPORT_FORMATS = ['raw-files', 'markdown', 'json']

/**
 * Renders a chat-attached artifact reference. Dispatches to a kind-specific view for
 * kinds with rich interactive presentation (debrief, quiz, teach-back); everything else falls back
 * to the generic metadata + export card.
 */
type ArtifactLookupState =
  | { status: 'loading' }
  | { status: 'ready'; artifact: ArtifactRow }
  | { status: 'missing' }
  | { status: 'error' }

export function ArtifactCard({
  artifactId,
  versionId,
  pending = false,
  referencedKind,
}: {
  artifactId: string
  versionId?: string
  pending?: boolean
  referencedKind?: string
}) {
  const [lookup, setLookup] = useState<ArtifactLookupState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    const load = () => {
      window.api.artifactGet(artifactId)
        .then((artifact) => {
          if (cancelled) return
          setLookup(artifact ? { status: 'ready', artifact } : { status: 'missing' })
        })
        .catch(() => {
          if (!cancelled) setLookup({ status: 'error' })
        })
    }

    setLookup({ status: 'loading' })
    load()
    const unsubscribe = window.api.onArtifactUpdated(({ artifactId: updatedId }) => {
      if (updatedId === artifactId) load()
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [artifactId])

  if (lookup.status === 'loading') return <ArtifactLoadingCard />
  if (lookup.status === 'missing') return <DeletedArtifactCard kind={referencedKind} />
  if (lookup.status === 'error') return <ArtifactUnavailableCard />

  const { artifact } = lookup
  if (artifact.kind === 'debrief') return <DebriefArtifactCard artifactId={artifactId} versionId={versionId} pending={pending} />
  if (artifact.kind === 'quiz') return <QuizArtifactCard artifactId={artifactId} versionId={versionId} pending={pending} />
  if (artifact.kind === 'teachback') return <TeachbackArtifactCard artifactId={artifactId} versionId={versionId} pending={pending} />
  if (artifact.kind === 'plan') return <PlanArtifactCard artifact={artifact} versionId={versionId} />
  return <GenericArtifactCard artifact={artifact} />
}

function PlanArtifactCard({ artifact, versionId }: { artifact: ArtifactRow; versionId?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [version, setVersion] = useState<ArtifactVersion | undefined>(artifact.currentVersion)
  const [content, setContent] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const selectedVersion = versionId && versionId !== artifact.currentVersion?.id
          ? await window.api.artifactGetVersion(versionId)
          : artifact.currentVersion
        if (!selectedVersion || cancelled) {
          if (!cancelled) setContent(null)
          return
        }
        setVersion(selectedVersion)
        const primaryFile = selectedVersion.files?.find((file) => file.role === 'primary') ?? selectedVersion.files?.[0]
        if (!primaryFile) {
          setContent(null)
          return
        }
        const result = await window.api.artifactGetFileContent(selectedVersion.id, primaryFile.relativePath)
        if (!cancelled) setContent(result.content)
      } catch {
        if (!cancelled) setContent(null)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [artifact.currentVersion, versionId])

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-3 dark:border-purple-700 dark:bg-purple-900/10">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={expanded}
      >
        <ListChecks className="h-4 w-4 shrink-0 text-purple-500" />
        <ArtifactKindBadge kind="plan" />
        <span className="flex-1 truncate text-xs font-semibold text-gray-800 dark:text-gray-200">
          {artifactDisplayTitle(artifact.title, artifact.kind)}
        </span>
        {version && <span className="text-[10px] text-gray-400">v{version.versionNumber}</span>}
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
      </button>
      {expanded && (
        <div className="mt-3 max-h-96 overflow-y-auto border-t border-purple-200 pt-3 text-sm dark:border-purple-800">
          {content === undefined
            ? <p className="text-xs text-gray-400">Loading plan…</p>
            : content
              ? <MarkdownRenderer content={content} />
              : <p className="text-xs text-gray-400">Plan content unavailable.</p>}
        </div>
      )}
    </div>
  )
}

function ArtifactLoadingCard() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-[11px] text-gray-400">
      <Package className="w-3.5 h-3.5" />
      Loading artifact…
    </div>
  )
}

function DeletedArtifactCard({ kind }: { kind?: string }) {
  const label = kind ? `${artifactKindLabel(kind)} deleted` : 'Artifact deleted'
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 text-[11px] text-gray-400 dark:text-gray-500">
      <PackageX className="w-3.5 h-3.5" />
      {label}
    </div>
  )
}

function ArtifactUnavailableCard() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-800 text-[11px] text-amber-600 dark:text-amber-400">
      <AlertCircle className="w-3.5 h-3.5" />
      Artifact unavailable
    </div>
  )
}

function GenericArtifactCard({ artifact }: { artifact: ArtifactRow }) {
  const [copying, setCopying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState('')

  const version = artifact.currentVersion
  const primaryFile = version?.files?.find((f) => f.role === 'primary') ?? version?.files?.[0]

  const handleCopyPath = async () => {
    if (!primaryFile) return
    await navigator.clipboard.writeText(primaryFile.absolutePath)
    setCopying(true)
    setTimeout(() => setCopying(false), 1500)
  }

  const handleExport = async (format: string) => {
    if (!version) return
    setExporting(true)
    setExportMsg('')
    try {
      const result = await window.api.artifactExport(version.id, format)
      setExportMsg(`Exported to: ${result.exportPath}`)
    } catch (e) {
      setExportMsg(`Export failed: ${String(e)}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="rounded-lg border border-purple-200 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-900/10 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Package className="w-3.5 h-3.5 text-purple-500 shrink-0" />
        <ArtifactKindBadge kind={artifact.kind} />
        <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex-1 truncate">{artifactDisplayTitle(artifact.title, artifact.kind)}</p>
        {version && (
          <span className="text-[10px] text-gray-400 shrink-0">v{version.versionNumber}</span>
        )}
      </div>

      {primaryFile && (
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400 flex-1 truncate">{primaryFile.absolutePath}</p>
          <button
            type="button"
            onClick={handleCopyPath}
            className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            title="Copy path"
          >
            {copying ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}

      {version && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-gray-400">Export:</span>
          {SUPPORTED_EXPORT_FORMATS.map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => handleExport(fmt)}
              disabled={exporting}
              className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 disabled:opacity-50 transition-colors"
            >
              {fmt}
            </button>
          ))}
        </div>
      )}

      {exportMsg && (
        <p className="text-[10px] text-gray-500 dark:text-gray-400 font-mono truncate">{exportMsg}</p>
      )}
    </div>
  )
}
