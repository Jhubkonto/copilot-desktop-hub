import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { Button } from './ui/primitives'
import type { SkillConfig } from '../../shared/types'

const EMPTY_SKILL: SkillConfig = {
  id: '',
  name: '',
  icon: '✨',
  description: '',
  instructions: '',
  tags: [],
  tools: {
    fileEdit: { enabled: false, approval: 'always-ask', instructions: '' },
    terminal: { enabled: false, approval: 'always-ask', instructions: '' },
    webFetch: { enabled: false, approval: 'always-ask', instructions: '' },
  },
  mcpServers: [],
  mcpServerTrust: [],
  mcpToolOverrides: [],
  knowledge: [],
}

const MIN_INSTRUCTIONS_HEIGHT = 180
const DEFAULT_INSTRUCTIONS_HEIGHT = 280

type ResizeState = {
  pointerId: number
  startY: number
  startHeight: number
}

export function SkillPanel() {
  const editingSkillId = useAppStore((s) => s.editingSkillId)
  const skills = useAppStore((s) => s.skills)
  const closeSkillPanel = useAppStore((s) => s.closeSkillPanel)
  const saveSkill = useAppStore((s) => s.saveSkill)
  const deleteSkill = useAppStore((s) => s.deleteSkill)
  const duplicateSkill = useAppStore((s) => s.duplicateSkill)
  const exportSkill = useAppStore((s) => s.exportSkill)

  const source = useMemo(() => editingSkillId ? skills.find((s) => s.id === editingSkillId) ?? null : null, [editingSkillId, skills])
  const [config, setConfig] = useState<SkillConfig>(() => source ? { ...source } : { ...EMPTY_SKILL })
  const [tagText, setTagText] = useState('')
  const [instructionsHeight, setInstructionsHeight] = useState(DEFAULT_INSTRUCTIONS_HEIGHT)
  const editorBodyRef = useRef<HTMLDivElement>(null)
  const instructionsRef = useRef<HTMLTextAreaElement>(null)
  const instructionsBoxRef = useRef<HTMLDivElement>(null)
  const tagsRef = useRef<HTMLInputElement>(null)
  const packageRef = useRef<HTMLElement>(null)
  const resizeRef = useRef<ResizeState | null>(null)

  useEffect(() => {
    setConfig(source ? { ...source } : { ...EMPTY_SKILL })
    setTagText(source?.tags.join(', ') ?? '')
  }, [source])

  const isEditing = !!source?.id
  const canSave = config.name.trim().length > 0

  const update = <K extends keyof SkillConfig>(key: K, value: SkillConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const getMaxInstructionsHeight = () => {
    const body = editorBodyRef.current
    const instructionsBox = instructionsBoxRef.current
    if (!body || !instructionsBox) return DEFAULT_INSTRUCTIONS_HEIGHT

    const bodyRect = body.getBoundingClientRect()
    const boxRect = instructionsBox.getBoundingClientRect()
    const bodyContentTop = bodyRect.top + body.clientTop
    const boxTop = boxRect.top - bodyContentTop + body.scrollTop
    const lastContentElement = packageRef.current ?? tagsRef.current
    const lastContentBottom = lastContentElement
      ? lastContentElement.getBoundingClientRect().bottom - bodyContentTop + body.scrollTop
      : boxRect.bottom - bodyContentTop + body.scrollTop
    const contentBelowBox = Math.max(0, lastContentBottom - (boxRect.bottom - bodyContentTop + body.scrollTop))
    const availableHeight = body.scrollTop + body.clientHeight - boxTop - contentBelowBox - 8

    return Math.max(MIN_INSTRUCTIONS_HEIGHT, Math.min(availableHeight, window.innerHeight))
  }

  const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    resizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: instructionsHeight,
    }
  }

  const handleResizeMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    const maxHeight = getMaxInstructionsHeight()
    const nextHeight = Math.max(
      MIN_INSTRUCTIONS_HEIGHT,
      Math.min(maxHeight, resize.startHeight + event.clientY - resize.startY),
    )
    setInstructionsHeight(nextHeight)
  }

  const handleResizeEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return
    resizeRef.current = null
    if (typeof event.currentTarget.hasPointerCapture === 'function' && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleSave = () => {
    if (!canSave) return
    void saveSkill({
      ...config,
      tags: tagText.split(',').map((tag) => tag.trim()).filter(Boolean),
    })
  }

  const maxInstructionsHeight = getMaxInstructionsHeight()
  const renderedInstructionsHeight = Math.min(instructionsHeight, maxInstructionsHeight)

  return (
    <div className="fixed inset-0 top-9 z-50 flex" role="dialog" aria-modal="true" aria-label="Skill configuration">
      <div className="flex-1 bg-black/30" onClick={closeSkillPanel} aria-hidden="true" />
      <div className="relative w-[440px] max-w-[92vw] bg-white dark:bg-gray-900 shadow-xl flex flex-col border-l border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-medium text-gray-800 dark:text-gray-100">
            {isEditing ? 'Edit Skill' : 'Create Skill'}
          </h2>
          <button
            onClick={closeSkillPanel}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close skill panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div ref={editorBodyRef} className="min-h-0 flex-1 overflow-y-auto p-4 space-y-5 mr-1.5">
          <section className="space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Skill</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Skills are package-backed instructions loaded only when activated. Tool access and approvals stay on the agent.
            </p>
            <div className="flex items-center gap-2">
              <input
                value={config.icon}
                onChange={(e) => update('icon', e.target.value)}
                maxLength={4}
                className="w-10 text-center text-xl border border-gray-200 dark:border-gray-700 rounded-lg px-1 py-1 bg-white dark:bg-gray-800 focus:outline-none"
                aria-label="Skill icon"
              />
              <input
                value={config.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="Skill name"
                className="flex-1 text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <input
              value={config.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="Short description"
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <div ref={instructionsBoxRef} className="relative w-full" style={{ height: renderedInstructionsHeight }}>
              <textarea
                ref={instructionsRef}
                value={config.instructions}
                onChange={(e) => update('instructions', e.target.value)}
                placeholder="Reusable instructions..."
                className="h-full w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 pb-5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
              <button
                type="button"
                onPointerDown={handleResizeStart}
                onPointerMove={handleResizeMove}
                onPointerUp={handleResizeEnd}
                onPointerCancel={handleResizeEnd}
                className="absolute bottom-0 left-1/2 h-4 w-12 -translate-x-1/2 cursor-ns-resize touch-none rounded-t-md text-gray-400 hover:text-indigo-500 dark:text-gray-500 dark:hover:text-indigo-300"
                aria-label="Resize skill instructions"
                aria-valuemin={MIN_INSTRUCTIONS_HEIGHT}
                aria-valuemax={Math.round(maxInstructionsHeight)}
                aria-valuenow={Math.round(renderedInstructionsHeight)}
                role="slider"
              >
                <span aria-hidden="true" className="mx-auto mt-1 block h-1 w-8 rounded-full bg-current" />
              </button>
            </div>
            <input
              ref={tagsRef}
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              placeholder="Tags, comma separated"
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </section>

          {isEditing && (
            <section ref={packageRef} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-800/60">
              <p className="font-medium text-gray-700 dark:text-gray-200">Package</p>
              <p className="mt-1 text-gray-500 dark:text-gray-400">
                {config.validationStatus ?? 'valid'} · {config.source ?? 'nexy'} · {config.contentHash?.slice(0, 12) ?? 'pending hash'}
              </p>
              {config.packagePath && <p className="mt-1 break-all font-mono text-[10px] text-gray-400">{config.packagePath}</p>}
              <div className="mt-3 border-t border-gray-200 pt-2 dark:border-gray-700">
                <p className="font-medium text-gray-700 dark:text-gray-200">
                  Files ({config.packageFiles?.length ?? 0})
                </p>
                <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto font-mono text-[10px] text-gray-500 dark:text-gray-400">
                  {(config.packageFiles ?? []).map((file) => (
                    <div key={file.relativePath} className="flex items-center justify-between gap-3">
                      <span className="truncate" title={file.relativePath}>{file.relativePath}</span>
                      <span className="shrink-0">{file.sizeBytes.toLocaleString()} B</span>
                    </div>
                  ))}
                  {(config.packageFiles?.length ?? 0) === 0 && <p className="italic">Package files are still loading.</p>}
                </div>
              </div>
            </section>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex gap-2">
            {isEditing && (
              <Button
                variant="secondary"
                onClick={() => void deleteSkill(config.id)}
                className="border-red-300 px-2 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {isEditing && (
              <>
                <Button variant="secondary" onClick={() => void duplicateSkill(config.id)}>
                  Duplicate
                </Button>
                <Button variant="secondary" onClick={() => void exportSkill(config.id)}>
                  Export
                </Button>
              </>
            )}
            {!isEditing && (
              <Button variant="secondary" onClick={closeSkillPanel}>
                Cancel
              </Button>
            )}
            <Button variant="primary" onClick={handleSave} disabled={!canSave}>
              {isEditing ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
