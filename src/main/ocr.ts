import { app } from 'electron'
import { join } from 'path'
import { createWorker as tesseractCreateWorker } from 'tesseract.js'

type TesseractWorker = {
  recognize: (image: Buffer | string) => Promise<{ data: { text: string } }>
  terminate: () => Promise<void>
}

let workerInstance: TesseractWorker | null = null
let initPromise: Promise<TesseractWorker> | null = null

function getTesseractPaths(): { workerPath: string; langPath: string } {
  const langPath = join(app.getPath('userData'), 'tesseract-lang')

  if (app.isPackaged) {
    const base = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'tesseract.js')
    return {
      workerPath: join(base, 'src', 'worker-script', 'node', 'index.js'),
      langPath,
    }
  }

  // Dev mode: dist/main/ is two levels below project root
  return {
    workerPath: join(__dirname, '..', '..', 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js'),
    langPath,
  }
}

async function createWorker(): Promise<TesseractWorker> {
  const { workerPath, langPath } = getTesseractPaths()
  const worker = await tesseractCreateWorker('eng', 1, {
    workerPath,
    langPath,
    logger: () => {},
  })
  return worker as unknown as TesseractWorker
}

async function getWorker(): Promise<TesseractWorker> {
  if (workerInstance) return workerInstance

  if (!initPromise) {
    initPromise = createWorker().then((w) => {
      workerInstance = w
      initPromise = null
      return w
    }).catch((err) => {
      initPromise = null
      throw err
    })
  }

  return initPromise
}

let activeJob: Promise<string> | null = null

export async function recognizeText(dataUrl: string): Promise<string> {
  // Serialize jobs — tesseract worker is single-threaded
  const run = async (): Promise<string> => {
    let worker: TesseractWorker
    try {
      worker = await getWorker()
    } catch (err) {
      throw new Error(`OCR init failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    try {
      const result = await worker.recognize(dataUrl)
      return result.data.text.trim()
    } catch (err) {
      // On recognition error, destroy the worker so next call re-initializes
      workerInstance = null
      try { await worker.terminate() } catch { /* ignore */ }
      throw new Error(`OCR recognition failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const job = activeJob ? activeJob.then(run, run) : run()
  const thisJob = job.finally(() => {
    if (activeJob === thisJob) activeJob = null
  })
  activeJob = thisJob
  return thisJob
}

export async function terminateOcrWorker(): Promise<void> {
  activeJob = null
  if (workerInstance) {
    const w = workerInstance
    workerInstance = null
    initPromise = null
    await w.terminate().catch(() => {})
  }
}
