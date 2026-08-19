#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const findings = []

const forbiddenPath = /(^|[\\/])(?:\.env(?:\..*)?|auth\.json|google-services\.json|.*(?:credentials|service-account).*\.json|.*\.(?:pem|p12|pfx|jks|keystore|key)|.*\.(?:db|db-shm|db-wal|sqlite|sqlite3)|(?:sessions?|logs?|cache|caches|user-data|browser-data|screenshots?|sandboxes)(?:[\\/]|$))/i
const secretPatterns = [
  /AIza[0-9A-Za-z_-]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:^|["'\s])(?:ghp_|github_pat_|xox[baprs]-|sk-(?:live|prod|proj)-)[A-Za-z0-9_-]{12,}/,
  /"private_key"\s*:\s*"-----BEGIN/,
]
const machinePathRoots = [
  process.env.USERPROFILE,
  process.env.HOME,
  process.env.HOMEDRIVE && process.env.HOMEPATH ? `${process.env.HOMEDRIVE}${process.env.HOMEPATH}` : null,
].filter(Boolean).map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
const machinePath = machinePathRoots.length ? new RegExp(machinePathRoots.join('|'), 'i') : null
const allowedExample = /(?:^|[\\/])(?:\.env\.example|google-services\.json\.example)$/i

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

function filesUnder(relativePath) {
  try {
    return execFileSync('rg', ['--files', relativePath], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
  } catch (error) {
    if (error?.status === 1) return []
    throw error
  }
}

function inspect(label, relativePath, bytes) {
  const normalized = relativePath.replaceAll('\\', '/')
  if (forbiddenPath.test(normalized) && !allowedExample.test(normalized)) {
    findings.push(`${label}: forbidden path ${normalized}`)
  }
  if (!bytes || bytes.includes('\u0000')) return
  for (const pattern of secretPatterns) {
    if (pattern.test(bytes)) findings.push(`${label}: secret signature in ${normalized}`)
  }
  if (machinePath?.test(bytes)) findings.push(`${label}: machine-specific path in ${normalized}`)
}

const tracked = git(['ls-files', '-z']).split('\u0000').filter(Boolean)
for (const relativePath of tracked) {
  const absolutePath = path.join(root, relativePath)
  if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) continue
  const stat = lstatSync(absolutePath)
  if (stat.size > 16 * 1024 * 1024) continue
  inspect('working tree', relativePath, readFileSync(absolutePath, 'utf8'))
}

for (const relativePath of ['dist', 'release']) {
  const absolutePath = path.join(root, relativePath)
  if (!existsSync(absolutePath)) continue
  const listed = filesUnder(relativePath)
  for (const file of listed) {
    const absoluteFile = path.join(root, file)
    const stat = lstatSync(absoluteFile)
    if (stat.size > 16 * 1024 * 1024) continue
    inspect('package input', file, readFileSync(absoluteFile, 'utf8'))
  }
}

const historicalNames = git(['log', '--all', '--format=', '--name-only', '--', 'android/app/google-services.json'])
if (historicalNames.trim()) findings.push('Git history: android/app/google-services.json is still reachable')

if (findings.length) {
  console.error(findings.map((finding) => `- ${finding}`).join('\n'))
  process.exit(1)
}

console.log('Security scan passed: no forbidden tracked/package files or supported secret signatures found.')
