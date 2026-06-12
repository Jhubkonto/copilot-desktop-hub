import { Plus, X } from 'lucide-react'
import type { ScopeRule } from '../../store/types'

interface Props {
  inScope: ScopeRule[]
  outOfScope: ScopeRule[]
  onAddScopeRule: (type: 'inScope' | 'outOfScope') => void
  onRemoveScopeRule: (type: 'inScope' | 'outOfScope', id: string) => void
  onScopeRuleChange: (type: 'inScope' | 'outOfScope', id: string, field: 'description' | 'pathGlob', val: string) => void
}

export function ScopeTab({ inScope, outOfScope, onAddScopeRule, onRemoveScopeRule, onScopeRuleChange }: Props) {
  return (
    <>
      {/* In Scope */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">In Scope</label>
          <button
            type="button"
            onClick={() => onAddScopeRule('inScope')}
            className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
            aria-label="Add in-scope rule"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
        {inScope.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">No in-scope rules. Add rules to tell the agent what to focus on.</p>
        )}
        <div className="space-y-2">
          {inScope.map((rule) => (
            <div key={rule.id} className="space-y-1">
              <div className="flex gap-1 items-center">
                <input
                  value={rule.description}
                  onChange={(e) => onScopeRuleChange('inScope', rule.id, 'description', e.target.value)}
                  placeholder="e.g. TypeScript source files in src/"
                  className="flex-1 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  aria-label="Scope rule description"
                />
                <button
                  type="button"
                  onClick={() => onRemoveScopeRule('inScope', rule.id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                  aria-label="Remove in-scope rule"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <input
                value={rule.pathGlob ?? ''}
                onChange={(e) => onScopeRuleChange('inScope', rule.id, 'pathGlob', e.target.value)}
                placeholder="Path glob (optional): e.g. src/**/*.ts"
                className="w-full text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
                aria-label="Scope rule path glob"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Out of Scope */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Out of Scope</label>
          <button
            type="button"
            onClick={() => onAddScopeRule('outOfScope')}
            className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
            aria-label="Add out-of-scope rule"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
        {outOfScope.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">No out-of-scope rules. Add rules to prevent scope creep.</p>
        )}
        <div className="space-y-2">
          {outOfScope.map((rule) => (
            <div key={rule.id} className="space-y-1">
              <div className="flex gap-1 items-center">
                <input
                  value={rule.description}
                  onChange={(e) => onScopeRuleChange('outOfScope', rule.id, 'description', e.target.value)}
                  placeholder="e.g. Do not change deployment configs"
                  className="flex-1 text-xs bg-white dark:bg-gray-700 border border-orange-200 dark:border-orange-800/50 rounded-lg px-2 py-1.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-orange-400"
                  aria-label="Out-of-scope rule description"
                />
                <button
                  type="button"
                  onClick={() => onRemoveScopeRule('outOfScope', rule.id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                  aria-label="Remove out-of-scope rule"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <input
                value={rule.pathGlob ?? ''}
                onChange={(e) => onScopeRuleChange('outOfScope', rule.id, 'pathGlob', e.target.value)}
                placeholder="Path glob (optional): e.g. infra/**"
                className="w-full text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
                aria-label="Out-of-scope rule path glob"
              />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
