# Model Catalog Sources

Nexy uses model data from three places:

- `src/main/model-catalog.ts`: `STATIC_SEED` is the fallback BYOK/provider catalog. It is cached in settings as `model_catalog_snapshot` and exposed through `model:list-catalog`.
- `src/main/cli-detection.ts`: `CLAUDE_DEFAULT_MODELS` and `CODEX_DEFAULT_MODELS` are CLI fallback lists, used only when live/cached data is unavailable. Codex prefers `~/.codex/models_cache.json` when available (a file Codex itself maintains). Claude CLI prefers the cached result of a live `GET https://api.anthropic.com/v1/models` call (see `src/main/anthropic-models.ts`), gated on a BYOK Anthropic API key being configured in Settings — this is a separate credential from the CLI's own OAuth session, so the resulting list reflects what the BYOK Anthropic account can access rather than the CLI session itself.
- `src/shared/models.ts`: `MODEL_LABELS` and multiplier maps are display/billing fallbacks for known model IDs and names.

These lists appear in model dropdowns when the live/cached catalog is empty, in Settings default-model selection, the chat composer model selector, regenerate-with-model menus, `/models`, and the `Continue with...` fork dialog. CLI fallback lists appear in CLI-specific model selectors and are also used by main-process fork validation.

Best practice is to treat hardcoded models as offline fallbacks only. The preferred order is:

1. Backend-specific live discovery or cached provider/CLI data.
2. Persisted catalog snapshots from prior discovery.
3. Static seed/fallback lists only when discovery is unavailable.

All three model sources now follow this hierarchy end-to-end:

- **OpenRouter**: `fetchAndCacheOpenRouterModels()` / `getOpenRouterModels()` in `src/main/provider-secrets.ts`, cached under the `openrouter_models_cache` settings key.
- **Claude CLI**: `fetchAndCacheAnthropicModels()` / `getCachedAnthropicModels()` in `src/main/anthropic-models.ts`, cached under the `anthropic_models_cache` settings key. Triggered on BYOK key save (`provider:set-key`), on successful key test (`testProviderKey`), and via a startup backfill in `registerModelAvailabilityHandlers()` if a key is configured but the cache is empty.
- **Codex CLI**: passive read of `~/.codex/models_cache.json`, refreshed by Codex itself — Nexy does not trigger this refresh.

Do not let hardcoded fallbacks bypass backend compatibility checks. Forking now validates selected agent/backend/model combinations in the main process and the renderer filters model options by selected backend.
