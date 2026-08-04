/* global require, __filename, process */
const { createRequire } = require('module')

const localRequire = createRequire(__filename)

process.parentPort.once('message', async (event) => {
  try {
    const request = event.data
    const sherpa = localRequire('sherpa-onnx-node')
    const tts = await sherpa.OfflineTts.createAsync({
      model: request.model,
      maxNumSentences: request.maxNumSentences,
    })
    const generationConfig = new sherpa.GenerationConfig({
      sid: request.generation.speakerId,
      speed: request.generation.speed,
      numSteps: 8,
      extra: { lang: request.generation.language },
    })
    const audio = await tts.generateAsync({
      text: request.generation.text,
      enableExternalBuffer: request.generation.enableExternalBuffer,
      generationConfig,
      onProgress: () => 1,
    })
    process.parentPort.postMessage({
      ok: true,
      samples: audio.samples,
      sampleRate: audio.sampleRate,
    })
  } catch (error) {
    process.parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    process.parentPort.close()
  }
})
