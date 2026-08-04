/* global AudioWorkletProcessor, registerProcessor */
class NexyPcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel && channel.length) this.port.postMessage(channel.slice())
    return true
  }
}

registerProcessor('nexy-pcm-capture', NexyPcmCaptureProcessor)
