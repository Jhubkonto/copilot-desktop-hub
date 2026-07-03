import { FileText, Pencil, Plus, X } from 'lucide-react'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { Button } from '../ui/primitives'
import type { KnowledgeFile } from './types'

interface Props {
  isEditing: boolean
  knowledgeFiles: KnowledgeFile[]
  editingKnowledgeFile: { id: string; filePath: string } | null
  editingFileContent: string
  onSetEditingFileContent: (v: string) => void
  onSetEditingKnowledgeFile: (v: { id: string; filePath: string } | null) => void
  onAddKnowledgeFile: () => void
  onRemoveKnowledgeFile: (id: string) => void
  onToggleInjectMode: (file: KnowledgeFile) => void
  onEditKnowledgeFile: (file: KnowledgeFile) => void
  onSaveKnowledgeFile: () => void
}

export function KnowledgeTab({
  isEditing,
  knowledgeFiles,
  editingKnowledgeFile,
  editingFileContent,
  onSetEditingFileContent,
  onSetEditingKnowledgeFile,
  onAddKnowledgeFile,
  onRemoveKnowledgeFile,
  onToggleInjectMode,
  onEditKnowledgeFile,
  onSaveKnowledgeFile,
}: Props) {
  if (editingKnowledgeFile) {
    return (
      <div className="flex flex-col gap-2 h-full">
        <div className="flex items-center justify-between gap-2 shrink-0">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
            {editingKnowledgeFile.filePath.split(/[\\/]/).pop()}
          </span>
          <div className="flex gap-1.5 shrink-0">
            <Button variant="primary" onClick={onSaveKnowledgeFile} aria-label="Save file">
              Save
            </Button>
            <Button variant="secondary" onClick={() => onSetEditingKnowledgeFile(null)}>
              Back
            </Button>
          </div>
        </div>
        <div className="flex gap-2 flex-1" style={{ minHeight: 0, height: 'calc(100vh - 220px)' }}>
          <textarea
            value={editingFileContent}
            onChange={(e) => onSetEditingFileContent(e.target.value)}
            spellCheck={false}
            className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          />
          <div className="flex-1 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
            <MarkdownRenderer content={editingFileContent} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {!isEditing ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">Save the agent first to add knowledge files.</p>
      ) : (
        <>
          {knowledgeFiles.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              No knowledge files yet. Add <code className="font-mono">.md</code> files to give this agent structured context.
            </p>
          ) : (
            <div className="space-y-1.5">
              {knowledgeFiles.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
                >
                  <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <span className="flex-1 text-xs text-gray-700 dark:text-gray-300 truncate" title={f.file_path}>
                    {f.file_path.split(/[\\/]/).pop()}
                  </span>
                  <button
                    onClick={() => onToggleInjectMode(f)}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 transition-colors ${
                      f.inject_mode === 'always'
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    }`}
                    title="Toggle inject mode"
                  >
                    {f.inject_mode === 'always' ? 'Always' : 'On demand'}
                  </button>
                  <button
                    onClick={() => onEditKnowledgeFile(f)}
                    className="text-gray-400 hover:text-blue-500 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                    aria-label={`Edit ${f.file_path}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onRemoveKnowledgeFile(f.id)}
                    className="text-gray-400 hover:text-red-500 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                    aria-label={`Remove ${f.file_path}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={onAddKnowledgeFile}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-colors w-full justify-center"
          >
            <Plus className="w-3.5 h-3.5" />
            Add file…
          </button>
        </>
      )}
    </div>
  )
}
