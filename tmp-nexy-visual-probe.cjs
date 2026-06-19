const { _electron } = require('playwright')
const path = require('path')
const fs = require('fs')

async function clickByText(win, out, label) {
  const t = Date.now()
  const loc = win.getByText(label, { exact: false }).first()
  await loc.click({ timeout: 4000 })
  await win.waitForTimeout(500)
  const shot = `click-${label.replace(/[^a-z0-9]/gi, '_')}.png`
  await win.screenshot({ path: path.join(out, shot), fullPage: true })
  return {
    label,
    ms: Date.now() - t,
    body: (await win.locator('body').innerText()).slice(0, 2000),
  }
}

async function dismissModal(win) {
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(150)
}

async function clickNamed(win, out, label, locatorFactory) {
  const t = Date.now()
  const loc = locatorFactory().first()
  await loc.click({ timeout: 5000 })
  await win.waitForTimeout(350)
  const shot = `deep-${label.replace(/[^a-z0-9]/gi, '_')}.png`
  await win.screenshot({ path: path.join(out, shot), fullPage: true })
  return {
    label,
    ms: Date.now() - t,
    body: (await win.locator('body').innerText()).slice(0, 2500),
  }
}

;(async () => {
  const out = path.join(process.cwd(), 'tmp-nexy-visual')
  fs.mkdirSync(out, { recursive: true })

  const start = Date.now()
  const userDataDir = path.join(out, 'user-data')
  fs.mkdirSync(userDataDir, { recursive: true })
  const dbDir = path.join(userDataDir, 'data')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'nexy.db')
  if (!fs.existsSync(dbPath)) fs.closeSync(fs.openSync(dbPath, 'w'))
  const app = await _electron.launch({
    args: [
      '.',
      `--user-data-dir=${userDataDir}`,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-gpu-compositing',
      '--disable-software-rasterizer',
      '--disable-dev-shm-usage',
    ],
    cwd: process.cwd(),
    timeout: 30000,
  })
  const win = await app.firstWindow({ timeout: 30000 })
  const ready = Date.now()

  const logs = []
  win.on('console', (msg) => logs.push({ type: msg.type(), text: msg.text() }))
  win.on('pageerror', (err) => logs.push({ type: 'pageerror', text: err.message }))

  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  const loaded = Date.now()

  await win.screenshot({ path: path.join(out, '01-home.png'), fullPage: true })

  const text = await win.locator('body').innerText({ timeout: 5000 }).catch((e) => `TEXT_ERROR ${e.message}`)
  const buttons = await win.locator('button')
    .evaluateAll((btns) => btns.slice(0, 100).map((b, i) => ({
      i,
      text: (b.innerText || b.getAttribute('aria-label') || b.title || '').trim(),
      aria: b.getAttribute('aria-label'),
      title: b.title,
      box: b.getBoundingClientRect().toJSON(),
    })))
    .catch((e) => [{ error: e.message }])

  const actions = []
  for (const item of ['Projects', 'Agents', 'Chats', 'Settings', 'MCP', 'Self-Heal', 'Artifacts']) {
    try {
      actions.push(await clickByText(win, out, item))
    } catch (e) {
      actions.push({ label: item, error: e.message })
    }
  }

  await dismissModal(win)

  const deepActions = []
  const runDeep = async (label, factory, after) => {
    try {
      deepActions.push(await clickNamed(win, out, label, factory))
      if (after) await after()
    } catch (e) {
      deepActions.push({ label, error: e.message })
    }
  }

  await runDeep('Artifacts sidebar', () => win.getByRole('button', { name: /Open Artifacts/i }))
  await runDeep('Self-Heal sidebar', () => win.getByRole('button', { name: /Open Self-Heal/i }))
  await runDeep('Agents sidebar', () => win.getByRole('button', { name: /Open agents/i }))
  await runDeep('Agent Generate modal', () => win.getByRole('button', { name: /^Generate$/i }), () => dismissModal(win))
  await runDeep('Projects sidebar', () => win.getByRole('button', { name: /Open projects/i }))
  await runDeep('Project New panel', () => win.getByRole('button', { name: /^New$/i }).first(), () => dismissModal(win))
  await runDeep('Settings open', () => win.getByRole('button', { name: /Open settings/i }))
  for (const tab of ['API Providers', 'CLI Tools', 'Prompts', 'Mobile', 'Developer']) {
    await runDeep(`Settings ${tab}`, () => win.getByRole('button', { name: new RegExp(`^${tab}$`, 'i') }))
  }
  await runDeep('Settings MCP configure', () => win.getByRole('button', { name: /^Configure$/i }))

  const perf = await win.evaluate(() => ({
    nav: performance.getEntriesByType('navigation')[0]?.toJSON?.(),
    resources: performance.getEntriesByType('resource')
      .map((r) => ({
        name: r.name.split('/').pop(),
        dur: Math.round(r.duration),
        size: r.transferSize || r.encodedBodySize || 0,
      }))
      .sort((a, b) => b.dur - a.dur)
      .slice(0, 15),
    memory: performance.memory ? {
      used: performance.memory.usedJSHeapSize,
      total: performance.memory.totalJSHeapSize,
      limit: performance.memory.jsHeapSizeLimit,
    } : null,
    marks: performance.getEntriesByType('mark').map((m) => ({ name: m.name, start: m.startTime })),
  }))

  const result = {
    timing: {
      launchToFirstWindowMs: ready - start,
      domContentPlusSettleMs: loaded - start,
    },
    text: text.slice(0, 4000),
    buttons,
    actions,
    deepActions,
    perf,
    logs: logs.slice(-50),
  }

  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2))
  await app.close()
  console.log(JSON.stringify(result, null, 2))
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
