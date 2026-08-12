const { _electron } = require('playwright')
const path = require('path')
const fs = require('fs')

;(async () => {
  const out = path.join(process.cwd(), 'tmp-nexy-visual')
  const userDataDir = path.join(out, 'mcp-user-data')
  fs.mkdirSync(userDataDir, { recursive: true })
  const app = await _electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    cwd: process.cwd(),
    timeout: 30000,
  })
  const win = await app.firstWindow({ timeout: 30000 })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1200)
  await win.getByRole('button', { name: 'Open settings' }).click()
  await win.waitForTimeout(500)
  await win.getByRole('button', { name: 'Configure' }).click()
  await win.waitForTimeout(500)
  await win.screenshot({ path: path.join(out, 'mcp-gallery.png'), fullPage: true })
  const gallery = (await win.locator('body').innerText()).slice(-5000)
  await win.getByText('GitHub', { exact: true }).click()
  await win.waitForTimeout(300)
  await win.screenshot({ path: path.join(out, 'mcp-github-form.png'), fullPage: true })
  const form = (await win.locator('body').innerText()).slice(-5000)
  await win.getByRole('button', { name: 'Back' }).click()
  await win.getByText('Browse official MCP Registry', { exact: true }).click()
  await win.waitForTimeout(300)
  await win.screenshot({ path: path.join(out, 'mcp-registry.png'), fullPage: true })
  const registry = (await win.locator('body').innerText()).slice(-5000)
  console.log(JSON.stringify({ gallery, form, registry }, null, 2))
  await app.close()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
