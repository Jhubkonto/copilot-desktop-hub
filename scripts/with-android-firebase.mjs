#!/usr/bin/env node
// Run an Android build with a protected Firebase file copied only for the
// duration of the command. The cleanup runs for success, failure, and signals.
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const separator = process.argv.indexOf('--')
const command = separator >= 0 ? process.argv[separator + 1] : undefined
const args = separator >= 0 ? process.argv.slice(separator + 2) : []
if (!command) {
  console.error('Usage: NEXY_FIREBASE_GOOGLE_SERVICES_PATH=... node scripts/with-android-firebase.mjs -- <command> [args...]')
  process.exit(2)
}

const target = path.resolve('android', 'app', 'google-services.json')
const protectedSource = process.env.NEXY_FIREBASE_GOOGLE_SERVICES_PATH
  ? path.resolve(process.env.NEXY_FIREBASE_GOOGLE_SERVICES_PATH)
  : null
let copied = false

if (existsSync(target)) {
  console.error('Refusing to run: android/app/google-services.json already exists. Remove the local Firebase file first.')
  process.exit(1)
}
if (protectedSource) {
  if (!existsSync(protectedSource)) {
    console.error('NEXY_FIREBASE_GOOGLE_SERVICES_PATH does not point to a readable file.')
    process.exit(1)
  }
  copyFileSync(protectedSource, target)
  copied = true
}

function cleanup() {
  if (copied) {
    try { unlinkSync(target) } catch {}
  }
}

const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal)
  })
}

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('close', (code, signal) => resolve(signal ? 1 : (code ?? 1)))
})
cleanup()
process.exit(exitCode)
