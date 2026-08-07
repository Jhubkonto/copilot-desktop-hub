import { existsSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { basename, join, resolve } from 'path'
import type { DiscoveredSkill, SkillConfig } from '../shared/types'
import { SKILL_ENTRY_FILE, cliHarnessSkillsRoot, loadSkillPackage } from './skill-packages'
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
  source: 'filesystem' | 'codex' | 'claude'
}

function homeRoot(...segments: string[]): SkillDiscoveryRoot['path'] {
  return join(homedir(), ...segments)
}

/** Labels a resolved harness path, preferring the tidy `~/.claude/skills` form but falling back to
 * the absolute path when an env override (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`) points elsewhere. */
function harnessRootLabel(resolvedPath: string, defaultLabel: string, defaultSegments: string[]): string {
  return resolvedPath === homeRoot(...defaultSegments) ? defaultLabel : resolvedPath
}

/** User-scoped skill locations shared across every project on this machine. Claude and Codex roots
 * honour `CLAUDE_CONFIG_DIR` / `CODEX_HOME` so a custom harness home is scanned instead of the
 * default `~/.claude` / `~/.codex`. */
export function userSkillDiscoveryRoots(): SkillDiscoveryRoot[] {
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
  }
  return roots
}

function describePackage(
  packagePath: string,
  root: SkillDiscoveryRoot,
  knownHashes: Set<string>,
): DiscoveredSkill {
  try {
    const loaded = loadSkillPackage(packagePath)
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
      validationStatus: loaded.validationStatus ?? 'valid',
      contentHash,
      alreadyImported: contentHash ? knownHashes.has(contentHash) : false,
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
      alreadyImported: false,
    }
  }
}

/**
 * Scans the given roots for `SKILL.md` packages. Symlinked entries are skipped, a package
 * reachable from multiple roots is reported once, and packages whose contents already match a
 * managed skill (by content hash) are flagged `alreadyImported`.
 */
export function discoverSkillPackages(
  roots: SkillDiscoveryRoot[],
  knownHashes: Set<string>,
): DiscoveredSkill[] {
  const seen = new Set<string>()
  const results: DiscoveredSkill[] = []
  for (const root of roots) {
    if (!root.path || !existsSync(root.path)) continue
    let entries
    try {
      entries = readdirSync(root.path, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue
      const packagePath = resolve(join(root.path, entry.name))
      if (seen.has(packagePath)) continue
      if (!existsSync(join(packagePath, SKILL_ENTRY_FILE))) continue
      seen.add(packagePath)
      results.push(describePackage(packagePath, root, knownHashes))
    }
  }
  return results
}

/**
 * Imports a discovered package into the managed library by copying it (never moving or mutating
 * the external source) and persisting a new skill row. The package's provenance
 * (`codex`/`claude`/`filesystem`) is preserved. Returns null if the package has gone away.
 */
export function importDiscoveredSkill(
  discovery: DiscoveredSkill,
  overrides: Partial<SkillConfig>,
): SkillConfig | null {
  if (!discovery || typeof discovery.packagePath !== 'string' || !existsSync(discovery.packagePath)) return null
  if (!existsSync(join(discovery.packagePath, SKILL_ENTRY_FILE))) return null
  const loaded = loadSkillPackage(discovery.packagePath)
  const input: Partial<SkillConfig> = {
    ...loaded,
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
