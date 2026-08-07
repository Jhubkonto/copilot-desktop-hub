import { createHash } from 'crypto'
import {
  existsSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import type { SkillConfig, SkillPackageFile } from '../shared/types'
import { parseSkillMarkdown, skillToMarkdown } from './skill-markdown'

export const SKILL_ENTRY_FILE = 'SKILL.md'
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_PACKAGE_FILE_COUNT = 256
const MAX_PACKAGE_FILE_BYTES = 5 * 1024 * 1024
const MAX_PACKAGE_TOTAL_BYTES = 20 * 1024 * 1024

export type SkillPackageValidation = {
  status: 'valid' | 'warning' | 'invalid'
  errors: string[]
  warnings: string[]
}

export function portableSkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '') || 'nexy-skill'
}

export function getManagedSkillRoot(): string {
  const electronApp = app as (typeof app & { getPath?: (name: string) => string }) | undefined
  const userData = typeof electronApp?.getPath === 'function'
    ? electronApp.getPath('userData')
    : join(tmpdir(), `nexy-skills-${process.pid}`)
  const root = join(userData, 'skills')
  mkdirSync(root, { recursive: true })
  return root
}

export function validateSkillPackage(skill: Partial<SkillConfig>, packagePath?: string): SkillPackageValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const name = String(skill.frontmatter?.name ?? skill.name ?? '').trim()
  if (!name || !SKILL_NAME.test(name) || name.length > 64) errors.push('name must be a lowercase hyphenated slug of at most 64 characters')
  const description = String(skill.description ?? '')
  if (!description.trim()) errors.push('description is required and must explain when to use the skill')
  if (description.length > 1024) errors.push('description must be at most 1024 characters')
  if (!String(skill.instructions ?? '').trim()) warnings.push('SKILL.md has no instruction body')
  if (packagePath && !existsSync(join(packagePath, SKILL_ENTRY_FILE))) errors.push('package does not contain SKILL.md')
  return { status: errors.length ? 'invalid' : warnings.length ? 'warning' : 'valid', errors, warnings }
}

function walkFiles(root: string, current = root): string[] {
  const files: string[] = []
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(current, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) files.push(...walkFiles(root, path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function portableRelativePath(root: string, file: string): string {
  return relative(root, file).replace(/\\/g, '/')
}

function safePackageTarget(packagePath: string, requestedPath: string): string {
  if (typeof requestedPath !== 'string' || !requestedPath.trim() || isAbsolute(requestedPath) || requestedPath.includes('\\')) {
    throw new Error('Skill package file path must be a POSIX-style relative path')
  }
  const root = resolve(packagePath)
  const candidate = resolve(root, requestedPath)
  const rel = relative(root, candidate)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Skill package file path escapes the package')
  let ancestor = dirname(candidate)
  while (ancestor !== root) {
    if (existsSync(ancestor) && lstatSync(ancestor).isSymbolicLink()) {
      throw new Error('Skill package file path traverses a symbolic link')
    }
    const parent = dirname(ancestor)
    if (parent === ancestor) throw new Error('Skill package file path escapes the package')
    ancestor = parent
  }
  return candidate
}

export function listSkillPackageFiles(packagePath: string): SkillPackageFile[] {
  if (!existsSync(packagePath)) return []
  const files = walkFiles(packagePath)
  if (files.length > MAX_PACKAGE_FILE_COUNT) throw new Error(`Skill package exceeds ${MAX_PACKAGE_FILE_COUNT} files`)
  let totalBytes = 0
  return files.map(file => {
    const bytes = readFileSync(file)
    totalBytes += bytes.byteLength
    if (bytes.byteLength > MAX_PACKAGE_FILE_BYTES) throw new Error('Skill package contains a file larger than 5 MB')
    if (totalBytes > MAX_PACKAGE_TOTAL_BYTES) throw new Error('Skill package exceeds the 20 MB transport limit')
    const utf8 = bytes.toString('utf8')
    const isUtf8 = !bytes.includes(0) && Buffer.from(utf8, 'utf8').equals(bytes)
    return {
      relativePath: portableRelativePath(packagePath, file),
      encoding: isUtf8 ? 'utf8' : 'base64',
      content: isUtf8 ? utf8 : bytes.toString('base64'),
      sizeBytes: bytes.byteLength,
    }
  })
}

/** Replaces package support files from a portable payload. SKILL.md is regenerated from metadata. */
export function applySkillPackageFiles(packagePath: string, packageFiles: SkillPackageFile[]): void {
  if (packageFiles.length > MAX_PACKAGE_FILE_COUNT) throw new Error(`Skill package exceeds ${MAX_PACKAGE_FILE_COUNT} files`)
  const decoded = packageFiles.map(file => {
    const target = safePackageTarget(packagePath, file.relativePath)
    if (file.encoding !== 'utf8' && file.encoding !== 'base64') throw new Error('Unsupported skill package file encoding')
    if (typeof file.content !== 'string') throw new Error('Skill package file content must be a string')
    const bytes = file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8')
    if (bytes.byteLength > MAX_PACKAGE_FILE_BYTES) throw new Error('Skill package contains a file larger than 5 MB')
    return { target, bytes }
  })
  if (decoded.reduce((sum, file) => sum + file.bytes.byteLength, 0) > MAX_PACKAGE_TOTAL_BYTES) {
    throw new Error('Skill package exceeds the 20 MB transport limit')
  }

  const keep = new Set(decoded.map(file => resolve(file.target)))
  for (const existing of walkFiles(packagePath)) {
    if (basename(existing).toLowerCase() === SKILL_ENTRY_FILE.toLowerCase()) continue
    if (!keep.has(resolve(existing))) rmSync(existing, { force: true })
  }
  for (const file of decoded) {
    if (basename(file.target).toLowerCase() === SKILL_ENTRY_FILE.toLowerCase()) continue
    mkdirSync(dirname(file.target), { recursive: true })
    writeFileSync(file.target, file.bytes)
  }
}

export function skillForTransport(skill: SkillConfig): SkillConfig {
  const { packagePath, ...portable } = skill
  return {
    ...portable,
    packageFiles: packagePath ? listSkillPackageFiles(packagePath) : [],
  }
}

export function hashSkillPackage(packagePath: string): string {
  const hash = createHash('sha256')
  for (const file of walkFiles(packagePath)) {
    hash.update(relative(packagePath, file).replace(/\\/g, '/'))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function uniquePackagePath(root: string, slug: string, current?: string): string {
  const candidate = join(root, slug)
  if (!existsSync(candidate) || resolve(candidate) === resolve(current ?? '')) return candidate
  let suffix = 2
  while (existsSync(`${candidate}-${suffix}`)) suffix++
  return `${candidate}-${suffix}`
}

/** Materialises/updates the canonical package while preserving unknown frontmatter and support files. */
export function writeManagedSkillPackage(skill: SkillConfig, previousPath?: string): SkillConfig {
  const managedRoot = getManagedSkillRoot()
  const slug = portableSkillName(String(skill.frontmatter?.name ?? skill.name))
  let packagePath = previousPath && existsSync(previousPath)
    ? previousPath
    : uniquePackagePath(managedRoot, slug)

  if (previousPath && existsSync(previousPath) && dirname(resolve(previousPath)) === resolve(managedRoot)) {
    const renamedPath = uniquePackagePath(managedRoot, slug, previousPath)
    if (resolve(renamedPath) !== resolve(previousPath)) {
      renameSync(previousPath, renamedPath)
      packagePath = renamedPath
    }
  }

  mkdirSync(packagePath, { recursive: true })
  const materialised: SkillConfig = {
    ...skill,
    packagePath,
    scope: skill.scope ?? 'user',
    source: skill.source ?? 'nexy',
  }
  writeFileSync(join(packagePath, SKILL_ENTRY_FILE), skillToMarkdown(materialised), 'utf8')
  const validation = validateSkillPackage(materialised, packagePath)
  return {
    ...materialised,
    contentHash: hashSkillPackage(packagePath),
    validationStatus: validation.status,
  }
}

export function importSkillPackage(sourcePath: string, skill: SkillConfig): SkillConfig {
  const managedRoot = getManagedSkillRoot()
  const packagePath = uniquePackagePath(managedRoot, portableSkillName(String(skill.frontmatter?.name ?? skill.name)))
  cpSync(sourcePath, packagePath, { recursive: true, dereference: false, errorOnExist: true })
  return writeManagedSkillPackage({ ...skill, source: 'import' }, packagePath)
}

export function duplicateSkillPackage(sourcePath: string | undefined, skill: SkillConfig): SkillConfig {
  if (!sourcePath || !existsSync(sourcePath)) return writeManagedSkillPackage(skill)
  const managedRoot = getManagedSkillRoot()
  const packagePath = uniquePackagePath(managedRoot, portableSkillName(String(skill.frontmatter?.name ?? skill.name)))
  cpSync(sourcePath, packagePath, { recursive: true, dereference: false, errorOnExist: true })
  return writeManagedSkillPackage(skill, packagePath)
}

export function exportSkillPackage(sourcePath: string, destinationRoot: string): string {
  const target = uniquePackagePath(destinationRoot, basename(sourcePath))
  cpSync(sourcePath, target, { recursive: true, dereference: false, errorOnExist: true })
  return target
}

export function loadSkillPackage(packagePath: string): Partial<SkillConfig> {
  const entryPath = join(packagePath, SKILL_ENTRY_FILE)
  const parsed = parseSkillMarkdown(readFileSync(entryPath, 'utf8'))
  const validation = validateSkillPackage(parsed, packagePath)
  return {
    ...parsed,
    packagePath: resolve(packagePath),
    contentHash: hashSkillPackage(packagePath),
    validationStatus: validation.status,
  }
}

export function deleteManagedSkillPackage(packagePath: string | undefined): void {
  if (!packagePath || !existsSync(packagePath)) return
  const managedRoot = realpathSync(getManagedSkillRoot())
  const target = realpathSync(packagePath)
  const rel = relative(managedRoot, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return
  rmSync(target, { recursive: true, force: true })
}

export function resolveSkillResource(packagePath: string, requestedPath: string): string {
  if (!requestedPath.trim() || isAbsolute(requestedPath)) throw new Error('Skill resource path must be relative')
  const root = realpathSync(packagePath)
  const candidate = resolve(root, requestedPath)
  const rel = relative(root, candidate)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Skill resource path escapes the package')
  if (!existsSync(candidate) || !lstatSync(candidate).isFile()) throw new Error('Skill resource does not exist')
  const realCandidate = realpathSync(candidate)
  const realRel = relative(root, realCandidate)
  if (realRel.startsWith('..') || isAbsolute(realRel)) throw new Error('Skill resource symlink escapes the package')
  return realCandidate
}

export function readSkillResource(packagePath: string, requestedPath: string): string {
  const path = resolveSkillResource(packagePath, requestedPath)
  const contents = readFileSync(path)
  if (contents.byteLength > 200_000) throw new Error('Skill resource exceeds the 200 KB context limit')
  if (contents.includes(0)) throw new Error('Binary skill assets cannot be loaded into model context')
  return contents.toString('utf8')
}

export function skillEntryMarkdown(skill: SkillConfig): string {
  if (skill.packagePath && existsSync(join(skill.packagePath, SKILL_ENTRY_FILE))) {
    return readFileSync(join(skill.packagePath, SKILL_ENTRY_FILE), 'utf8')
  }
  return skillToMarkdown(skill)
}

export function packageRootFromImport(filePath: string): string | null {
  return basename(filePath).toLowerCase() === SKILL_ENTRY_FILE.toLowerCase() ? dirname(filePath) : null
}
