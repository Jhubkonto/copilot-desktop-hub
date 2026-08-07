import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { SkillConfig } from '../shared/types'
import { SKILL_ENTRY_FILE, cliHarnessSkillsRoot, portableSkillName } from './skill-packages'

/**
 * CLI-backend skill bridging.
 *
 * The Claude and Codex CLI harnesses only load skills they find on disk in their own skills
 * directory — they never see Nexy's managed library. Bridging materialises an agent's attached
 * skill packages into that directory when a CLI-backed agent runs, so the harness can discover
 * and use them. Every bridged package is copied (never moved) and marked with a
 * `.nexy-managed.json` file, so cleanup can remove exactly what Nexy created without ever
 * touching the user's own on-disk skills.
 */

/** Marker written into every Nexy-bridged package directory so cleanup can identify it. */
const MARKER_FILE = '.nexy-managed.json'

export interface BridgedSkill {
  skillId: string
  slug: string
  targetPath: string
}

interface ManagedMarker {
  managedBy: 'nexy'
  skillId: string
  contentHash?: string
  bridgedAt: number
}

/** The skills directory each CLI harness scans for user-scoped skill packages, or null if the
 * backend has no on-disk skill discovery to bridge into. */
export function cliSkillsRoot(backend: string): string | null {
  if (backend === 'claude-cli') return cliHarnessSkillsRoot('claude')
  if (backend === 'codex-cli') return cliHarnessSkillsRoot('codex')
  return null
}

function readMarker(dir: string): ManagedMarker | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, MARKER_FILE), 'utf8')) as ManagedMarker
    return parsed && parsed.managedBy === 'nexy' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Chooses the on-disk directory name for a bridged skill. Uses the skill's portable slug so the
 * harness's one-level `<root>/<name>/SKILL.md` discovery finds it. If that directory already
 * exists and is a real user skill (no Nexy marker), a `-nexy` suffix is used instead so the
 * user's own package is never overwritten. A directory Nexy already owns for this skill is reused.
 */
function resolveTargetDir(root: string, slug: string, skillId: string): string {
  const primary = join(root, slug)
  const primaryMarker = existsSync(primary) ? readMarker(primary) : null
  if (!existsSync(primary) || primaryMarker?.skillId === skillId) return primary
  let candidate = join(root, `${slug}-nexy`)
  let suffix = 2
  while (existsSync(candidate)) {
    if (readMarker(candidate)?.skillId === skillId) return candidate
    candidate = join(root, `${slug}-nexy-${suffix++}`)
  }
  return candidate
}

/** Copies the given managed skill packages into `root`, marking each as Nexy-managed. Exposed for
 * testing with an explicit directory; production callers use {@link bridgeSkillsForCliRun}. */
export function bridgeSkillsToRoot(root: string, skills: SkillConfig[]): BridgedSkill[] {
  const bridged: BridgedSkill[] = []
  for (const skill of skills) {
    if (!skill.packagePath || !existsSync(join(skill.packagePath, SKILL_ENTRY_FILE))) continue
    const slug = portableSkillName(String(skill.frontmatter?.name ?? skill.name))
    const targetPath = resolveTargetDir(root, slug, skill.id)
    try {
      // Replace any prior Nexy copy so an edited skill re-materialises cleanly. Never delete a
      // directory Nexy does not own (resolveTargetDir already routed around user skills).
      if (existsSync(targetPath) && readMarker(targetPath)) rmSync(targetPath, { recursive: true, force: true })
      mkdirSync(root, { recursive: true })
      cpSync(skill.packagePath, targetPath, { recursive: true, dereference: false })
      const marker: ManagedMarker = {
        managedBy: 'nexy',
        skillId: skill.id,
        contentHash: skill.contentHash,
        bridgedAt: Date.now(),
      }
      writeFileSync(join(targetPath, MARKER_FILE), JSON.stringify(marker, null, 2), 'utf8')
      bridged.push({ skillId: skill.id, slug, targetPath })
    } catch {
      // Best-effort: a failure to bridge one skill must never abort the CLI turn.
    }
  }
  return bridged
}

/** Sweeps every Nexy-marked directory under `root`, never removing an unmarked (user-owned) one.
 * Exposed for testing; production callers use {@link cleanupBridgedSkills}. */
export function cleanupManagedSkillsInRoot(root: string): number {
  if (!existsSync(root)) return 0
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(root, e.name))
  let removed = 0
  for (const dir of candidates) {
    if (!existsSync(dir) || !readMarker(dir)) continue
    try {
      rmSync(dir, { recursive: true, force: true })
      removed++
    } catch {
      // Best-effort teardown.
    }
  }
  return removed
}

// A bridged package directory can be shared by several in-flight CLI runs (two conversations
// using the same agent, or the same skill attached to different agents). Reference-count each
// bridged path so a finishing run only removes a package no other active run still depends on.
const activeRefs = new Map<string, number>()

/**
 * Materialises an agent's attached skill packages into the CLI backend's skills directory so a
 * CLI-backed run can discover them. Idempotent and non-destructive to the user's own skills.
 * Each bridged path is reference-counted; pass the returned list to {@link releaseBridgedSkills}
 * when the run ends. Returns an empty list for backends without on-disk skill discovery.
 */
export function bridgeSkillsForCliRun(backend: string, skills: SkillConfig[]): BridgedSkill[] {
  const root = cliSkillsRoot(backend)
  if (!root || skills.length === 0) return []
  const bridged = bridgeSkillsToRoot(root, skills)
  for (const b of bridged) activeRefs.set(b.targetPath, (activeRefs.get(b.targetPath) ?? 0) + 1)
  return bridged
}

/**
 * Releases the packages a finished CLI run bridged, removing only those no other active run still
 * references. Safe to call unconditionally at the end of a run (a no-op for an empty list).
 */
export function releaseBridgedSkills(bridged: BridgedSkill[]): number {
  let removed = 0
  for (const b of bridged) {
    const count = (activeRefs.get(b.targetPath) ?? 0) - 1
    if (count > 0) {
      activeRefs.set(b.targetPath, count)
      continue
    }
    activeRefs.delete(b.targetPath)
    if (existsSync(b.targetPath) && readMarker(b.targetPath)) {
      try {
        rmSync(b.targetPath, { recursive: true, force: true })
        removed++
      } catch {
        // Best-effort teardown.
      }
    }
  }
  return removed
}

/** Sweeps every Nexy-managed bridged package from a CLI backend's skills directory, regardless of
 * reference count. Intended for teardown (e.g. app shutdown) where no CLI run is in flight. */
export function cleanupBridgedSkills(backend: string): number {
  const root = cliSkillsRoot(backend)
  if (!root) return 0
  activeRefs.clear()
  return cleanupManagedSkillsInRoot(root)
}
