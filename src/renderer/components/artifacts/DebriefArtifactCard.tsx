import { useEffect, useState } from 'react'
import { BookOpen, Download, Loader2 } from 'lucide-react'
import type { ArtifactRow } from '@shared/types'

interface DebriefSectionData {
  summary: string
  commandsAndTools: string[]
  reproductionGuide: string
  mentalModel: string
}

const LABEL_CLASS = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500'

export function DebriefArtifactCard({ artifactId, versionId: _versionId }: { artifactId: string; versionId?: string }) {
  const [artifact, setArtifact] = useState<ArtifactRow | null>(null)
  const [section, setSection] = useState<DebriefSectionData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    setArtifact(null)
    setSection(null)
    setError(null)
    window.api.artifactGet(artifactId)
      .then(async (a) => {
        if (cancelled || !a) return
        setArtifact(a)
        const versionId = a.currentVersionId
        if (!versionId) return
        const result = await window.api.artifactGetFileContent(versionId, 'debrief.json')
        if (cancelled) return
        setSection(JSON.parse(result.content) as DebriefSectionData)
      })
      .catch(() => { if (!cancelled) setError('Failed to load debrief') })
    return () => { cancelled = true }
  }, [artifactId])

  const handleExportMd = async () => {
    const versionId = artifact?.currentVersionId
    if (!versionId) return
    setExporting(true)
    setExportMsg('')
    try {
      const result = await window.api.artifactExport(versionId, 'markdown')
      setExportMsg(`Exported to: ${result.exportPath}`)
    } catch (e) {
      setExportMsg(`Export failed: ${String(e)}`)
    } finally {
      setExporting(false)
    }
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 text-[11px] text-red-500">
        {error}
      </div>
    )
  }

  if (!artifact || !section) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-[11px] text-gray-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading debrief…
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/10 p-4 space-y-3 max-w-2xl">
      <div className="flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-indigo-500 shrink-0" />
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex-1 truncate">{artifact.title}</p>
        {artifact.currentVersion && (
          <span className="text-[10px] text-gray-400 shrink-0">v{artifact.currentVersion.versionNumber}</span>
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

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={handleExportMd}
          disabled={exporting}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
          Export Markdown
        </button>
        {exportMsg && <p className="text-[10px] text-gray-500 dark:text-gray-400 font-mono truncate">{exportMsg}</p>}
      </div>
    </div>
  )
}
