import { existsSync, type Dirent } from 'fs'
import { readdir as readdirAsync } from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, join, resolve } from 'path'
import type { DiscoveredSkill, SkillConfig } from '../shared/types'
import { SKILL_ENTRY_FILE, cliHarnessSkillsRoot, loadSkillPackage, loadSkillPackageAsync, validateSkillPackage } from './skill-packages'
import { createSkillConfig } from './skills'

/**
 * A standard on-disk location that harnesses (Claude Code, Codex, generic agents) read skill
 * packages from. Discovery is strictly read-only: Nexy never writes into these roots.
 */
export interface SkillDiscoveryRoot {
  /** Absolute directory that contains one skill package per child directory. */
  path: string
  /** Human-readable label surfaced in the UI, e.g. `~/.claude/skills`. */
  label: string
  scope: 'user' | 'project'
  source: 'filesystem' | 'codex' | 'claude' | 'hermes'
}

function homeRoot(...segments: string[]): SkillDiscoveryRoot['path'] {
  return join(homedir(), ...segments)
}

/** Labels a resolved harness path, preferring the tidy `~/.claude/skills` form but falling back to
 * the absolute path when an env override (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`) points elsewhere. */
function harnessRootLabel(resolvedPath: string, defaultLabel: string, defaultSegments: string[]): string {
  return resolvedPath === homeRoot(...defaultSegments) ? defaultLabel : resolvedPath
}

function hermesRoot(): string {
  const nativeRoot = process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'hermes')
    : homeRoot('.hermes')
  const configured = (process.env.HERMES_HOME ?? '').trim()
  if (!configured) return nativeRoot
  const resolved = resolve(configured)
  // Hermes can launch with HERMES_HOME pointing at a profile. Climb back to the shared root so
  // all sibling profiles remain discoverable, matching the CLI's own profile resolution.
  return basename(dirname(resolved)) === 'profiles' ? dirname(dirname(resolved)) : resolved
}

async function hermesSkillDiscoveryRoots(): Promise<SkillDiscoveryRoot[]> {
  const root = hermesRoot()
  const roots: SkillDiscoveryRoot[] = [{
    path: join(root, 'skills'),
    label: `${root}/skills`,
    scope: 'user',
    source: 'hermes',
  }]
  const profilesPath = join(root, 'profiles')
  try {
    for (const entry of await readdirAsync(profilesPath, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue
      roots.push({
        path: join(profilesPath, entry.name, 'skills'),
        label: `${root}/profiles/${entry.name}/skills`,
        scope: 'user',
        source: 'hermes',
      })
    }
  } catch {
    // Keep the standard roots available if the profile directory is inaccessible.
  }
  return roots
}

/** User-scoped skill locations shared across every project on this machine. Claude and Codex roots
 * honour `CLAUDE_CONFIG_DIR` / `CODEX_HOME` so a custom harness home is scanned instead of the
 * default `~/.claude` / `~/.codex`. */
export async function userSkillDiscoveryRoots(): Promise<SkillDiscoveryRoot[]> {
  const claudeRoot = cliHarnessSkillsRoot('claude')
  const codexRoot = cliHarnessSkillsRoot('codex')
  return [
    {
      path: claudeRoot,
      label: harnessRootLabel(claudeRoot, '~/.claude/skills', ['.claude', 'skills']),
      scope: 'user',
      source: 'claude',
    },
    {
      path: codexRoot,
      label: harnessRootLabel(codexRoot, '~/.codex/skills', ['.codex', 'skills']),
      scope: 'user',
      source: 'codex',
    },
    { path: homeRoot('.agents', 'skills'), label: '~/.agents/skills', scope: 'user', source: 'filesystem' },
    ...(await hermesSkillDiscoveryRoots()),
  ]
}

/** Project-scoped skill locations rooted at each enabled project source directory. */
export function projectSkillDiscoveryRoots(sourceRoots: string[]): SkillDiscoveryRoot[] {
  const roots: SkillDiscoveryRoot[] = []
  for (const src of sourceRoots) {
    if (typeof src !== 'string' || !src.trim()) continue
    const projectLabel = basename(src) || src
    roots.push({
      path: join(src, '.claude', 'skills'),
      label: `${projectLabel}/.claude/skills`,
      scope: 'project',
      source: 'claude',
    })
    roots.push({
      path: join(src, '.agents', 'skills'),
      label: `${projectLabel}/.agents/skills`,
      scope: 'project',
      source: 'filesystem',
    })
    roots.push({
      path: join(src, 'skills'),
      label: `${projectLabel}/skills`,
      scope: 'project',
      source: 'filesystem',
    })
  }
  return roots
}

async function describePackage(
  packagePath: string,
  root: SkillDiscoveryRoot,
  knownHashes: Set<string>,
): Promise<DiscoveredSkill> {
  try {
    const loaded = await loadSkillPackageAsync(packagePath)
    const validation = validateSkillPackage(loaded, packagePath)
    const contentHash = typeof loaded.contentHash === 'string' ? loaded.contentHash : undefined
    const frontmatterName = loaded.frontmatter && typeof loaded.frontmatter.name === 'string'
      ? loaded.frontmatter.name
      : undefined
    return {
      packagePath,
      name: String(frontmatterName ?? loaded.name ?? basename(packagePath)).trim() || basename(packagePath),
      description: typeof loaded.description === 'string' ? loaded.description : '',
      icon: typeof loaded.icon === 'string' && loaded.icon.trim() ? loaded.icon.trim().slice(0, 8) : '✨',
      scope: root.scope,
      source: root.source,
      rootLabel: root.label,
      validationStatus: validation.status,
      validationErrors: validation.errors,
      validationWarnings: validation.warnings,
      importable: true,
      contentHash,
      alreadyImported: contentHash ? knownHashes.has(contentHash) : false,
      runtimeRequirements: loaded.runtimeRequirements,
    }
  } catch {
    // A malformed package is surfaced as invalid rather than hidden, so the user can see why it
    // cannot be imported instead of it silently vanishing from the scan.
    return {
      packagePath,
      name: basename(packagePath),
      description: '',
      icon: '✨',
      scope: root.scope,
      source: root.source,
      rootLabel: root.label,
      validationStatus: 'invalid',
      validationErrors: ['SKILL.md could not be read or parsed.'],
      importable: false,
      alreadyImported: false,
    }
  }
}

/**
 * Scans the given roots for `SKILL.md` packages. Skill stores may group packages in category
 * directories, so the walk continues until it finds an entry file and then treats that directory
 * as the package boundary. Symlinked entries are skipped, a package reachable from multiple roots
 * is reported once, and packages whose contents already match a managed skill (by content hash) are
 * flagged `alreadyImported`.
 */
export async function discoverSkillPackages(
  roots: SkillDiscoveryRoot[],
  knownHashes: Set<string>,
): Promise<DiscoveredSkill[]> {
  const seen = new Set<string>()
  const results: DiscoveredSkill[] = []
  for (const root of roots) {
    if (!root.path) continue
    let entries: Dirent<string>[]
    try {
      entries = await readdirAsync(root.path, { withFileTypes: true })
    } catch {
      continue
    }
    const visit = async (directory: string): Promise<void> => {
      let children: Dirent<string>[]
      try {
        children = await readdirAsync(directory, { withFileTypes: true })
      } catch {
        return
      }
      if (children.some((child) => !child.isSymbolicLink() && child.isFile() && child.name === SKILL_ENTRY_FILE)) {
        const packagePath = resolve(directory)
        if (!seen.has(packagePath)) {
          seen.add(packagePath)
          results.push(await describePackage(packagePath, root, knownHashes))
        }
        return
      }
      for (const child of children) {
        if (child.isSymbolicLink() || !child.isDirectory()) continue
        await visit(join(directory, child.name))
      }
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue
      await visit(join(root.path, entry.name))
    }
  }
  return results
}

/**
 * Imports a discovered package into the managed library by copying it (never moving or mutating
 * the external source) and persisting a new skill row. Readable packages are accepted across
 * providers; the managed writer supplies portable fallback metadata when a provider omits it.
 * The package's provenance is preserved. Returns null if the package has gone away or cannot parse.
 */
export function importDiscoveredSkill(
  discovery: DiscoveredSkill,
  overrides: Partial<SkillConfig>,
): SkillConfig | null {
  if (!discovery || typeof discovery.packagePath !== 'string' || !existsSync(discovery.packagePath)) return null
  if (!existsSync(join(discovery.packagePath, SKILL_ENTRY_FILE))) return null
  const loaded = loadSkillPackage(discovery.packagePath)
  const importedName = typeof loaded.name === 'string' && loaded.name.trim()
    ? loaded.name.trim()
    : discovery.name.trim() || basename(discovery.packagePath)
  const importedDescription = typeof loaded.description === 'string' && loaded.description.trim()
    ? loaded.description
    : `Reusable guidance for ${importedName}. Use when the task matches this skill's instructions.`
  const input: Partial<SkillConfig> = {
    ...loaded,
    name: importedName,
    description: importedDescription,
    ...overrides,
    // createSkillConfig copies from packageSourcePath into the managed root; drop the external
    // path and stale hash so the managed package becomes the canonical source.
    packagePath: undefined,
    contentHash: undefined,
    scope: discovery.scope,
    source: discovery.source,
  }
  return createSkillConfig(input, discovery.packagePath)
}
