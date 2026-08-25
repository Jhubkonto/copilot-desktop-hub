import { existsSync, readdirSync, realpathSync, statSync } from 'fs'
import { execFileSync } from 'child_process'
import { basename, isAbsolute, relative, resolve, sep, win32 } from 'path'
import { isRemoteImagePath } from './file-handlers'

export type ProjectPeekFilter = 'all' | 'documents' | 'images' | 'recent'
export type ProjectPeekGitState = 'clean' | 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'ignored' | 'staged' | 'unknown'

export interface ProjectPeekSource {
  id: string
  projectId: string
  label: string
  localPath: string
  enabled: boolean
  isPrimary: boolean
}

export interface ProjectPeekEntry {
  name: string
  relativePath: string
  type: 'file' | 'dir'
  category: 'document' | 'image' | 'html' | 'other'
  sizeBytes: number
  modifiedAt: number
  gitState: ProjectPeekGitState
}

export interface ProjectPeekDirectoryResult {
  entries: ProjectPeekEntry[]
  truncated: boolean
  error?: string
}

const DIRECTORY_LIMIT = 1000
const DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc', '.json', '.yaml', '.yml'])
const HTML_EXTENSIONS = new Set(['.html', '.htm'])

function withinRoot(candidate: string, root: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** Resolves a source-relative request and follows it once to ensure symlinks cannot escape. */
export function resolveProjectPeekPath(sourceRoot: string, relativePath: string): string | null {
  const requested = relativePath.replace(/\\/g, '/')
  if (isAbsolute(requested) || win32.isAbsolute(relativePath) || requested.split('/').some((part) => part === '..')) return null
  try {
    const root = realpathSync(sourceRoot)
    const candidate = resolve(root, ...requested.split('/').filter(Boolean))
    if (!withinRoot(candidate, root) || !existsSync(candidate)) return null
    const actual = realpathSync(candidate)
    return withinRoot(actual, root) ? actual : null
  } catch {
    return null
  }
}

function categoryFor(path: string, type: 'file' | 'dir'): ProjectPeekEntry['category'] {
  if (type === 'dir') return 'other'
  if (isRemoteImagePath(path)) return 'image'
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : ''
  if (HTML_EXTENSIONS.has(ext)) return 'html'
  return DOCUMENT_EXTENSIONS.has(ext) ? 'document' : 'other'
}

function allows(entry: ProjectPeekEntry, filter: ProjectPeekFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'recent') return entry.type === 'file'
  // HTML previews live alongside Markdown/text under the "Documents" filter chip — a separate
  // chip for one extension pair isn't worth the extra UI surface.
  if (filter === 'documents') return entry.category === 'document' || entry.category === 'html'
  return entry.category === 'image'
}

/** One bounded Git-status read per source request. A non-repository simply stays `unknown`. */
function gitStatesForSource(sourceRoot: string): Map<string, ProjectPeekGitState> | null {
  try {
    const output = execFileSync('git', ['-C', sourceRoot, 'status', '--porcelain=v1', '--ignored', '--untracked-files=all'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    })
    const states = new Map<string, ProjectPeekGitState>()
    for (const line of output.split(/\r?\n/)) {
      if (line.length < 4) continue
      const status = line.slice(0, 2)
      const path = line.slice(3).replace(/\\/g, '/')
      const state: ProjectPeekGitState = status === '??' ? 'untracked'
        : status === '!!' ? 'ignored'
        : status.includes('R') ? 'renamed'
        : status.includes('D') ? 'deleted'
        : status.includes('A') ? 'added'
        : status[0] !== ' ' ? 'staged'
        : 'modified'
      states.set(path, state)
    }
    return states
  } catch { return null }
}

/** Lists one source directory without ever returning desktop-native paths to the mobile client. */
export function listProjectPeekDirectory(
  source: ProjectPeekSource,
  relativePath: string,
  filter: ProjectPeekFilter = 'all',
): ProjectPeekDirectoryResult {
  if (!source.enabled) return { entries: [], truncated: false, error: 'This project source is disabled' }
  const directory = resolveProjectPeekPath(source.localPath, relativePath)
  if (!directory) return { entries: [], truncated: false, error: 'This project folder is not available' }
  try {
    if (!statSync(directory).isDirectory()) return { entries: [], truncated: false, error: 'Not a directory' }
    const gitStates = gitStatesForSource(source.localPath)
    const entries: ProjectPeekEntry[] = []
    for (const name of readdirSync(directory)) {
      const childRelativePath = relativePath ? `${relativePath.replace(/\\/g, '/').replace(/\/$/, '')}/${name}` : name
      const childPath = resolveProjectPeekPath(source.localPath, childRelativePath)
      if (!childPath) continue
      let stat: ReturnType<typeof statSync>
      try { stat = statSync(childPath) } catch { continue }
      const type: 'file' | 'dir' = stat.isDirectory() ? 'dir' : 'file'
      const entry: ProjectPeekEntry = {
        name: basename(childPath), relativePath: childRelativePath, type,
        category: categoryFor(childPath, type), sizeBytes: type === 'file' ? stat.size : 0,
        modifiedAt: stat.mtimeMs, gitState: gitStates?.get(childRelativePath) ?? (gitStates ? 'clean' : 'unknown'),
      }
      if (allows(entry, filter)) entries.push(entry)
    }
    const sorted = filter === 'recent'
      ? entries.sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name))
      : entries.sort((a, b) => Number(b.type === 'dir') - Number(a.type === 'dir') || a.name.localeCompare(b.name))
    return { entries: sorted.slice(0, DIRECTORY_LIMIT), truncated: sorted.length > DIRECTORY_LIMIT }
  } catch {
    return { entries: [], truncated: false, error: 'Could not read this project folder' }
  }
}
