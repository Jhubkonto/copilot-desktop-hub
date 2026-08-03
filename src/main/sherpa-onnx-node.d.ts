declare module 'sherpa-onnx-node' {
  export class GenerationConfig {
    constructor(config: {
      sid: number
      speed: number
      numSteps: number
      extra: { lang: string }
    })
  }

  export class OfflineTts {
    static createAsync(config: unknown): Promise<OfflineTts>
    generateAsync(input: {
      text: string
      enableExternalBuffer: boolean
      generationConfig: GenerationConfig
      onProgress?: (progress: { samples: Float32Array; progress: number }) => number
    }): Promise<{ samples: Float32Array; sampleRate: number }>
  }
}
