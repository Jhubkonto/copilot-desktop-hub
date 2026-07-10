import { useEffect, useState } from 'react'
import { Plus, RotateCcw, X } from 'lucide-react'
import { DEFAULT_VERIFY_COMMANDS } from '../../../shared/code-changes'
import type { RemoteEditVerifyCommandConfig } from '../../store/types'
import { useAppStore } from '../../store/app-store'

interface Props {
  projectId: string
  verifyCommands: RemoteEditVerifyCommandConfig[] | null
}

function slugify(label: string, existing: Set<string>): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'command'
  let candidate = base
  let n = 1
  while (existing.has(candidate)) candidate = `${base}-${++n}`
  return candidate
}

export function VerifyTab({ projectId, verifyCommands }: Props) {
  const updateProjectConfig = useAppStore((s) => s.updateProjectConfig)
  const isCustom = verifyCommands !== null && verifyCommands.length > 0
  const [rows, setRows] = useState<RemoteEditVerifyCommandConfig[]>(verifyCommands ?? DEFAULT_VERIFY_COMMANDS)

  useEffect(() => {
    setRows(verifyCommands ?? DEFAULT_VERIFY_COMMANDS)
  }, [projectId, verifyCommands])

  const save = (next: RemoteEditVerifyCommandConfig[] | null) => {
    void updateProjectConfig(projectId, { verifyCommands: next })
  }

  const handleRowChange = (index: number, field: 'label' | 'command', value: string) => {
    const next = rows.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    setRows(next)
    save(next)
  }

  const handleRemove = (index: number) => {
    const next = rows.filter((_, i) => i !== index)
    setRows(next)
    save(next.length > 0 ? next : null)
  }

  const handleAdd = () => {
    const existingIds = new Set(rows.map((r) => r.id))
    const next = [...rows, { id: slugify('command', existingIds), label: '', command: '' }]
    setRows(next)
    save(next)
  }

  const handleReset = () => {
    setRows(DEFAULT_VERIFY_COMMANDS)
    save(null)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Verification commands</label>
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          Commands Code Changes runs to verify a patch before it can be committed. Each runs as its own shell command in the project's workspace directory. Defaults to <code className="bg-gray-100 dark:bg-gray-700 px-0.5 rounded">npm run typecheck/lint/test/build</code> until you customize this list.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((row, idx) => (
          <div key={row.id} className="flex gap-1 items-start">
            <div className="flex-1 flex flex-col gap-1">
              <input
                value={row.label}
                onChange={(e) => handleRowChange(idx, 'label', e.target.value)}
                placeholder="Label (e.g. Typecheck)"
                className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                aria-label={`Verify command label ${idx + 1}`}
              />
              <input
                value={row.command}
                onChange={(e) => handleRowChange(idx, 'command', e.target.value)}
                placeholder="Shell command (e.g. npm run typecheck)"
                className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 font-mono text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                aria-label={`Verify command shell command ${idx + 1}`}
              />
            </div>
            <button
              type="button"
              onClick={() => handleRemove(idx)}
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
              aria-label={`Remove ${row.label || 'command'}`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleAdd}
            className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
          >
            <Plus className="w-3.5 h-3.5" />
            Add command
          </button>
          {isCustom && (
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to defaults
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
