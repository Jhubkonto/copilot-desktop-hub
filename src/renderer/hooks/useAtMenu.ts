import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { AT_CONTEXT_OPTIONS, type ContextRef } from './chat-types'

interface UseAtMenuParams {
  input: string
  setInput: Dispatch<SetStateAction<string>>
  projectId?: string | null
  projectRootDir?: string | null
}

export function useAtMenu({ input, setInput, projectId, projectRootDir }: UseAtMenuParams) {
  const [showAtMenu, setShowAtMenu] = useState(false)
  const [atFilter, setAtFilter] = useState('')
  const [selectedAtIndex, setSelectedAtIndex] = useState(0)

  const contextRefs = useMemo(() => {
    const refs: ContextRef[] = []
    const regex = /(?:^|\s)@(workspace|git:diff|git|wiki)\b|(?:^|\s)@file:([^\s]+)/gi
    let match: RegExpExecArray | null

    while ((match = regex.exec(input)) !== null) {
      if (match[1]) {
        const raw = match[1].toLowerCase()
        if (raw === 'git:diff') {
          refs.push({ key: 'git-diff', token: '@git:diff' })
        } else {
          const key = raw as 'workspace' | 'git' | 'wiki'
          refs.push({ key, token: `@${key}` })
        }
      } else if (match[2]) {
        refs.push({ key: 'file', token: `@file:${match[2]}`, value: match[2] })
      }
    }

    return refs
  }, [input])

  const filteredAtOptions = useMemo(() => {
    const filter = atFilter.toLowerCase()
    return AT_CONTEXT_OPTIONS.filter((option) =>
      option.token.slice(1).startsWith(filter),
    )
  }, [atFilter])

  const openAtMenu = useCallback((filter = '') => {
    setShowAtMenu(true)
    setAtFilter(filter)
    setSelectedAtIndex(0)
  }, [])

  const closeAtMenu = useCallback(() => {
    setShowAtMenu(false)
    setAtFilter('')
    setSelectedAtIndex(0)
  }, [])

  const removeContextToken = useCallback(
    (token: string) => {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      setInput((prev) =>
        prev
          .replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'g'), ' ')
          .replace(/\s{2,}/g, ' ')
          .trim(),
      )
    },
    [setInput],
  )

  const resolveContextBlock = useCallback(async (refs: ContextRef[]) => {
    const lines: string[] = []

    for (const ref of refs) {
      if (ref.key === 'workspace') {
        const summary = await window.api.getWorkspaceSummary(projectRootDir ?? undefined)
        lines.push(`[Workspace]\n${summary}`)
        continue
      }

      if (ref.key === 'git') {
        const gitContext = await window.api.getGitContext()
        lines.push(`[Git]\n${gitContext}`)
        continue
      }

      if (ref.key === 'git-diff') {
        const diff = await window.api.getGitDiff()
        lines.push(`[Git Diff]\n${diff}`)
        continue
      }

      if (ref.key === 'clipboard') {
        if (ref.value) {
          const MAX_CHARS = 4000
          const text = ref.value.length > MAX_CHARS ? ref.value.slice(0, MAX_CHARS) + '\n... (truncated)' : ref.value
          lines.push(`[Clipboard]\n${text}`)
        }
        continue
      }

      if (ref.key === 'prompt-instruction') {
        if (ref.value) {
          lines.push(`[Temporary Instructions]\n${ref.value}`)
        }
        continue
      }

      if (ref.key === 'file' && ref.value) {
        const result = await window.api.readContextFile(ref.value)
        const header = result.truncated
          ? `File: ${result.path} (truncated)`
          : `File: ${result.path}`
        lines.push(`${header}\n\`\`\`\n${result.content}\n\`\`\``)
        continue
      }

      if (ref.key === 'wiki') {
        if (!projectId) continue
        const entries = await window.api.listWikiEntries(projectId)
        if (!entries || entries.length === 0) continue
        const MAX_BODY = 500
        const MAX_ENTRIES = 10
        const formatted = entries.slice(0, MAX_ENTRIES).map((e) => {
          const body = e.body.length > MAX_BODY ? e.body.slice(0, MAX_BODY) + '...' : e.body
          const tags = e.tags && e.tags.length > 0 ? ` [${e.tags.join(', ')}]` : ''
          return `### ${e.title}${tags}\n${body}`
        })
        lines.push(`[Project Wiki]\n${formatted.join('\n\n')}`)
      }

    }

    return lines.join('\n\n')
  }, [projectId])

  return {
    showAtMenu,
    atFilter,
    selectedAtIndex,
    filteredAtOptions,
    contextRefs,
    openAtMenu,
    closeAtMenu,
    setAtFilter,
    setSelectedAtIndex,
    resolveContextBlock,
    removeContextToken,
  }
}
