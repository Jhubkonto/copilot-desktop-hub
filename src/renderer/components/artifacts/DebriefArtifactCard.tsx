import { useCallback, useEffect, useState } from 'react'
import { NexyIcon } from '../ui/icons/NexyIcon'
import type { ArtifactRow, ArtifactVersion, DebriefStory, DebriefStoryTone, StoryMood } from '@shared/types'
import { sanitizeStorySvg } from '../../lib/story-svg'
import { useAppStore } from '../../store/app-store'

const STORY_TONES: { value: DebriefStoryTone; label: string }[] = [
  { value: 'adventure', label: 'Adventure' },
  { value: 'noir', label: 'Noir' },
  { value: 'fable', label: 'Fable' },
  { value: 'deadpan-technical', label: 'Deadpan technical' },
]

interface DebriefSectionData {
  summary: string
  commandsAndTools: string[]
  reproductionGuide: string
  mentalModel: string
}

const LABEL_CLASS = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500'

const MOOD_EMOJI: Record<StoryMood, string> = { problem: '🧩', attempt: '🔧', discovery: '💡', resolution: '✅' }

function StoryBeatView({ caption, mood, svg }: { caption: string; mood: StoryMood; svg: string }) {
  const safeSvg = sanitizeStorySvg(svg)

  return (
    <div className="flex items-start gap-3 rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised p-2.5">
      <div className="w-10 h-10 shrink-0 flex items-center justify-center rounded-md bg-indigo-100/70 dark:bg-indigo-900/30 text-indigo-500 dark:text-indigo-300">
        {safeSvg
          ? <span className="w-6 h-6" dangerouslySetInnerHTML={{ __html: safeSvg }} />
          : <span className="text-lg leading-none">{MOOD_EMOJI[mood]}</span>}
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300 flex-1 pt-1.5">{caption}</p>
    </div>
  )
}

export function DebriefArtifactCard({ artifactId, versionId, pending = false }: { artifactId: string; versionId?: string; pending?: boolean }) {
  const [artifact, setArtifact] = useState<ArtifactRow | null>(null)
  const [version, setVersion] = useState<ArtifactVersion | null>(null)
  const [lockedVersion, setLockedVersion] = useState<{ artifactId: string; versionId: string } | null>(null)
  const [section, setSection] = useState<DebriefSectionData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [exportMsg, setExportMsg] = useState('')
  const [regenerating, setRegenerating] = useState(false)
  const [view, setView] = useState<'structured' | 'story'>('structured')
  const [story, setStory] = useState<DebriefStory | null>(null)
  const [storyLoading, setStoryLoading] = useState(false)
  const [storyError, setStoryError] = useState<string | null>(null)
  const [showStylePicker, setShowStylePicker] = useState(false)
  const [storyTone, setStoryTone] = useState<DebriefStoryTone>('adventure')
  const [storyBeatCount, setStoryBeatCount] = useState(5)
  const lockedVersionId = lockedVersion?.artifactId === artifactId ? lockedVersion.versionId : null
  const conversations = useAppStore((s) => s.conversations)

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
    setView('structured')
    setStory(null)
    setStoryError(null)
    setShowStylePicker(false)
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
    const model = conversations.find((c) => c.id === conversationId)?.model ?? undefined
    setRegenerating(true)
    try {
      await window.api.startDebriefGeneration(conversationId, artifact?.projectId ?? null, model)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate debrief')
    } finally {
      setRegenerating(false)
    }
  }, [artifact, conversations, load, version])

  const fetchStory = useCallback(async (forceRegenerate = false) => {
    const conversationId = version?.sourceConversationId ?? artifact?.currentVersion?.sourceConversationId ?? artifact?.conversationId
    if (!conversationId) return
    const model = conversations.find((c) => c.id === conversationId)?.model ?? undefined
    setStoryLoading(true)
    setStoryError(null)
    try {
      const result = await window.api.generateDebriefStory(conversationId, artifact?.projectId ?? null, model, forceRegenerate, storyTone, storyBeatCount)
      setStory(result.story)
    } catch (err) {
      setStoryError(err instanceof Error ? err.message : 'Failed to generate story')
    } finally {
      setStoryLoading(false)
    }
  }, [artifact, conversations, storyBeatCount, storyTone, version])

  const handleViewStory = () => {
    setView('story')
    if (!story) setShowStylePicker(true)
  }

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

  const handleDownloadMd = async () => {
    const exportVersionId = version?.id ?? artifact?.currentVersionId
    if (!exportVersionId) return
    setDownloading(true)
    setExportMsg('')
    try {
      const result = await window.api.artifactDownload(exportVersionId, 'markdown')
      if (!result.canceled && result.downloadPath) {
        setExportMsg(`Downloaded to: ${result.downloadPath}`)
      }
    } catch (e) {
      setExportMsg(`Download failed: ${String(e)}`)
    } finally {
      setDownloading(false)
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
            {regenerating && <NexyIcon name="busy" size={12} />}
            Try again
          </button>
        )}
      </div>
    )
  }

  const isPendingGenerating = pending && !versionId && !lockedVersionId && artifact?.status === 'generating'
  if (isPendingGenerating || !artifact || !section) {
    return (
      <div className="flex items-center gap-2 rounded-nexy-sm border-2 border-nexy-activity bg-nexy-recessed px-3 py-2 text-[11px] text-nexy-activity shadow-nexy">
        <NexyIcon name="busy" size={14} />
        {isPendingGenerating ? 'Generating debrief…' : 'Loading debrief…'}
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-3 rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed p-4 shadow-nexy">
      <div className="flex items-center gap-2">
        <NexyIcon name="artifact" size={16} className="text-primary" />
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex-1 truncate">{artifact.title}</p>
        {(version ?? artifact.currentVersion) && (
          <span className="text-[10px] text-gray-400 shrink-0">v{(version ?? artifact.currentVersion)!.versionNumber}</span>
        )}
      </div>

      <div className="flex w-fit items-center gap-1 rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised p-0.5">
        <button
          type="button"
          onClick={() => setView('structured')}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${view === 'structured' ? 'bg-white dark:bg-gray-800 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300'}`}
        >
          Structured
        </button>
        <button
          type="button"
          onClick={handleViewStory}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${view === 'story' ? 'bg-white dark:bg-gray-800 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300'}`}
        >
          <NexyIcon name="spark" size={12} />
          Story
        </button>
      </div>

      {view === 'story' ? (
        <div className="space-y-2.5">
          {showStylePicker && (
            <div className="flex flex-col gap-2 rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised p-2.5 shadow-nexy">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Tone</span>
                {STORY_TONES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setStoryTone(t.value)}
                    className={`rounded-nexy-sm border-2 px-2 py-0.5 text-xs transition-colors ${storyTone === t.value ? 'border-nexy-accent bg-nexy-accent text-nexy-on-accent' : 'border-nexy-border bg-nexy-recessed text-nexy-text'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Beats</span>
                <input
                  type="range"
                  min={3}
                  max={5}
                  value={storyBeatCount}
                  onChange={(e) => setStoryBeatCount(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-xs text-gray-500 w-4 text-center">{storyBeatCount}</span>
              </div>
              <button
                type="button"
                onClick={() => { setShowStylePicker(false); void fetchStory(Boolean(story)) }}
                className="self-end flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white transition-colors"
              >
                <NexyIcon name="spark" size={12} />
                {story ? 'Retell with this style' : 'Tell the story'}
              </button>
            </div>
          )}
          {storyLoading && (
            <div className="flex items-center gap-2 text-[11px] text-indigo-600 dark:text-indigo-300">
              <NexyIcon name="busy" size={14} />
              Writing the story…
            </div>
          )}
          {!storyLoading && storyError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 text-[11px] text-red-500">
              <span className="flex-1">{storyError}</span>
              <button
                type="button"
                onClick={() => void fetchStory()}
                className="flex items-center gap-1 shrink-0 px-2 py-0.5 rounded border border-red-300 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
              >
                Try again
              </button>
            </div>
          )}
          {!storyLoading && !storyError && story && (
            <>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{story.title}</p>
              {story.beats.map((beat, i) => (
                <StoryBeatView key={i} caption={beat.caption} mood={beat.mood} svg={beat.svg} />
              ))}
              <button
                type="button"
                onClick={() => setShowStylePicker(true)}
                disabled={storyLoading}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                <NexyIcon name="refresh" size={12} />
                Retell
              </button>
            </>
          )}
        </div>
      ) : (
      <>
      <div>
        <p className={LABEL_CLASS}>Summary</p>
        <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{section.summary}</p>
      </div>

      {section.commandsAndTools.length > 0 && (
        <div>
          <p className={LABEL_CLASS}>Commands & Tools</p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {section.commandsAndTools.map((tag, i) => (
              <span key={i} className="rounded-nexy-sm border border-nexy-border bg-nexy-raised px-2 py-0.5 text-xs text-nexy-text">
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
      </>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportMd}
            disabled={exporting}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <NexyIcon name={exporting ? 'busy' : 'download'} size={12} />
            Export Markdown
          </button>
          <button
            type="button"
            onClick={handleDownloadMd}
            disabled={downloading}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <NexyIcon name={downloading ? 'busy' : 'folder'} size={12} />
            Download
          </button>
        </div>
        {exportMsg && <p className="text-[10px] text-gray-500 dark:text-gray-400 font-mono truncate min-w-0">{exportMsg}</p>}
      </div>
    </div>
  )
}
