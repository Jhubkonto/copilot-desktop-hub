import { useState, useEffect } from 'react'
import { Package, Copy, CheckCircle } from 'lucide-react'

import type { ArtifactRow } from '@shared/types'

const KIND_LABELS: Record<string, string> = {
  document: 'Doc', code: 'Code', ui: 'UI', data: 'Data',
  prompt: 'Prompt', 'agent-config': 'Agent', plan: 'Plan', bundle: 'Bundle', other: 'Other',
}

const SUPPORTED_EXPORT_FORMATS = ['raw-files', 'markdown', 'json']

export function ArtifactCard({ artifactId, versionId: _versionId }: { artifactId: string; versionId?: string }) {
  const [artifact, setArtifact] = useState<ArtifactRow | null>(null)
  const [copying, setCopying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState('')

  useEffect(() => {
    window.api.artifactGet(artifactId).then((a) => setArtifact(a)).catch(() => {})
  }, [artifactId])

  if (!artifact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-[11px] text-gray-400">
        <Package className="w-3.5 h-3.5" />
        Loading artifact…
      </div>
    )
  }

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
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium">
          {KIND_LABELS[artifact.kind] ?? artifact.kind}
        </span>
        <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex-1 truncate">{artifact.title}</p>
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
