import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Download, Loader2 } from 'lucide-react'
import type { ArtifactRow, ArtifactVersion } from '@shared/types'

interface DebriefSectionData {
  summary: string
  commandsAndTools: string[]
  reproductionGuide: string
  mentalModel: string
}

const LABEL_CLASS = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500'

export function DebriefArtifactCard({ artifactId, versionId, pending = false }: { artifactId: string; versionId?: string; pending?: boolean }) {
  const [artifact, setArtifact] = useState<ArtifactRow | null>(null)
  const [version, setVersion] = useState<ArtifactVersion | null>(null)
  const [lockedVersion, setLockedVersion] = useState<{ artifactId: string; versionId: string } | null>(null)
  const [section, setSection] = useState<DebriefSectionData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState('')
  const [regenerating, setRegenerating] = useState(false)
  const lockedVersionId = lockedVersion?.artifactId === artifactId ? lockedVersion.versionId : null

  const load = useCallback(() => {
    setError(null)
    window.api.artifactGet(artifactId)
      .then(async (a) => {
        if (!a) throw new Error('Artifact not found')
        setArtifact(a)

        const isPendingThisVersion = pending && !versionId && !lockedVersionId
        if (a.status === 'failed' && (isPendingThisVersion || !a.currentVersionId)) {
          setError(a.errorMessage ?? 'Debrief generation failed')
          setVersion(null)
          setSection(null)
          return
        }
        if (a.status === 'generating' && isPendingThisVersion) {
          setVersion(null)
          setSection(null)
          return
        }

        const targetVersionId = versionId ?? lockedVersionId ?? a.currentVersionId
        if (!targetVersionId) {
          setVersion(null)
          setSection(null)
          return
        }

        const targetVersion = versionId || lockedVersionId
          ? await window.api.artifactGetVersion(targetVersionId)
          : a.currentVersion
        if (!targetVersion) throw new Error('Debrief version not found')

        if (!versionId && !lockedVersionId) setLockedVersion({ artifactId, versionId: targetVersion.id })
        setVersion(targetVersion)
        const result = await window.api.artifactGetFileContent(targetVersion.id, 'debrief.json')
        setSection(JSON.parse(result.content) as DebriefSectionData)
      })
      .catch(() => setError('Failed to load debrief'))
  }, [artifactId, lockedVersionId, pending, versionId])

  useEffect(() => {
    setArtifact(null)
    setVersion(null)
    setSection(null)
    setError(null)
  }, [artifactId, versionId])

  useEffect(() => {
    load()
  }, [load])

  // The artifact is created with status 'generating' before the LLM call resolves, so this
  // card can be attached to the transcript immediately and survive the user navigating away
  // mid-generation. Refresh on the push event, with a poll as a fallback in case it's missed.
  useEffect(() => {
    return window.api.onArtifactUpdated(({ artifactId: updatedId }) => {
      if (updatedId === artifactId) load()
    })
  }, [artifactId, load])

  useEffect(() => {
    if (!(pending && !versionId && !lockedVersionId && artifact?.status === 'generating')) return
    const interval = setInterval(load, 4000)
    return () => clearInterval(interval)
  }, [artifact?.status, load, lockedVersionId, pending, versionId])

  const handleRegenerate = useCallback(async () => {
    const conversationId = version?.sourceConversationId ?? artifact?.currentVersion?.sourceConversationId ?? artifact?.conversationId
    if (!conversationId) return
    setRegenerating(true)
    try {
      await window.api.startDebriefGeneration(conversationId, artifact?.projectId ?? null)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate debrief')
    } finally {
      setRegenerating(false)
    }
  }, [artifact, load, version])

  const handleExportMd = async () => {
    const exportVersionId = version?.id ?? artifact?.currentVersionId
    if (!exportVersionId) return
    setExporting(true)
    setExportMsg('')
    try {
      const result = await window.api.artifactExport(exportVersionId, 'markdown')
      setExportMsg(`Exported to: ${result.exportPath}`)
    } catch (e) {
      setExportMsg(`Export failed: ${String(e)}`)
    } finally {
      setExporting(false)
    }
  }

  if (error) {
    const canRegenerate = artifact?.status === 'failed' && Boolean(version?.sourceConversationId ?? artifact.currentVersion?.sourceConversationId ?? artifact.conversationId)
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 text-[11px] text-red-500">
        <span className="flex-1">{error}</span>
        {canRegenerate && (
          <button
            type="button"
            onClick={() => void handleRegenerate()}
            disabled={regenerating}
            className="flex items-center gap-1 shrink-0 px-2 py-0.5 rounded border border-red-300 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 transition-colors"
          >
            {regenerating && <Loader2 className="w-3 h-3 animate-spin" />}
            Try again
          </button>
        )}
      </div>
    )
  }

  const isPendingGenerating = pending && !versionId && !lockedVersionId && artifact?.status === 'generating'
  if (isPendingGenerating || !artifact || !section) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-900/10 text-[11px] text-indigo-600 dark:text-indigo-300">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {isPendingGenerating ? 'Generating debrief…' : 'Loading debrief…'}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/10 p-4 space-y-3 max-w-2xl">
      <div className="flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-indigo-500 shrink-0" />
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex-1 truncate">{artifact.title}</p>
        {(version ?? artifact.currentVersion) && (
          <span className="text-[10px] text-gray-400 shrink-0">v{(version ?? artifact.currentVersion)!.versionNumber}</span>
        )}
      </div>

      <div>
        <p className={LABEL_CLASS}>Summary</p>
        <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{section.summary}</p>
      </div>

      {section.commandsAndTools.length > 0 && (
        <div>
          <p className={LABEL_CLASS}>Commands & Tools</p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {section.commandsAndTools.map((tag, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className={LABEL_CLASS}>How to Reproduce</p>
        <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap">{section.reproductionGuide}</p>
      </div>

      <div>
        <p className={LABEL_CLASS}>Mental Model / Approach</p>
        <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap">{section.mentalModel}</p>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={handleExportMd}
          disabled={exporting}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors shrink-0 whitespace-nowrap"
        >
          {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
          Export Markdown
        </button>
        {exportMsg && <p className="text-[10px] text-gray-500 dark:text-gray-400 font-mono truncate min-w-0">{exportMsg}</p>}
      </div>
    </div>
  )
}
