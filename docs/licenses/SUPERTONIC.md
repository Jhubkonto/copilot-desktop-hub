# Supertonic local speech output

Nexy optionally downloads the `sherpa-onnx-supertonic-3-tts-int8-2026-05-11`
model when a user selects **Install Supertonic** in Settings. The model is not
included in the Nexy source tree or application installer.

- Model author: Supertone Inc.
- Model license: OpenRAIL-M
- Model license: https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE
- Model package: https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models
- Inference runtime: sherpa-onnx 1.13.4, Apache-2.0
- Runtime source: https://github.com/k2-fsa/sherpa-onnx

The downloaded model is stored beneath Nexy's per-user application-data
directory and can be removed from Settings. Nexy verifies the official release
archive against its published SHA-256 digest before activation.
