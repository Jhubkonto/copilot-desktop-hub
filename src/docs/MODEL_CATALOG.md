# Model Catalog Sources

Nexy uses model data from three places:

- `src/main/model-catalog.ts`: `STATIC_SEED` is the fallback BYOK/provider catalog. It is cached in settings as `model_catalog_snapshot` and exposed through `model:list-catalog`.
- `src/main/cli-detection.ts`: `CLAUDE_DEFAULT_MODELS` and `CODEX_DEFAULT_MODELS` are CLI fallback lists. Codex prefers `~/.codex/models_cache.json` when available.
- `src/shared/models.ts`: `MODEL_LABELS` and multiplier maps are display/billing fallbacks for known model IDs and names.

These lists appear in model dropdowns when the live/cached catalog is empty, in Settings default-model selection, the chat composer model selector, regenerate-with-model menus, `/models`, and the `Continue with...` fork dialog. CLI fallback lists appear in CLI-specific model selectors and are also used by main-process fork validation.

Best practice is to treat hardcoded models as offline fallbacks only. The preferred order is:

1. Backend-specific live discovery or cached provider/CLI data.
2. Persisted catalog snapshots from prior discovery.
3. Static seed/fallback lists only when discovery is unavailable.

Do not let hardcoded fallbacks bypass backend compatibility checks. Forking now validates selected agent/backend/model combinations in the main process and the renderer filters model options by selected backend.
