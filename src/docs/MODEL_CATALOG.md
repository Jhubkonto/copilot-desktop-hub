# Model Catalog Sources

Nexy derives all "known model" metadata (labels, billing multipliers, and the
fallback catalog seed) from a **single canonical list**, `KNOWN_MODELS` in
`src/shared/models.ts`:

- `MODEL_LABELS` and the multiplier map are generated from `KNOWN_MODELS`.
- `getStaticCatalogSeed()` projects `KNOWN_MODELS` into `CatalogModel[]`, which
  `src/main/model-catalog.ts` re-exports as `STATIC_SEED` (cached in settings as
  `model_catalog_snapshot`, exposed through `model:list-catalog`).

Add or update a model in `KNOWN_MODELS` once and labels, multipliers, and the
catalog seed all move together — they can no longer drift apart.

Which provider *offers* which model is a separate concern, defined by the
per-provider `models` arrays in `src/main/provider-registry.ts`. The authoritative
dropdown list for a configured provider comes from `getProviderModelIds()` (same
file), which **merges the static array with the provider's live `/models` cache**
(deduped by a normalized ID key so dotted/dashed/dated spellings collapse to one
entry). Both the desktop dropdowns (`model-availability.ts`) and the Android
companion (`ws-handlers.ts` `model:list`) call this one function, so they stay in
sync.

Other sources:

- `src/main/cli-detection.ts`: `CLAUDE_DEFAULT_MODELS` and `CODEX_DEFAULT_MODELS` are CLI fallback lists, used only when live/cached data is unavailable. Codex prefers `~/.codex/models_cache.json` when available (a file Codex itself maintains). Claude CLI prefers the cached result of a live `GET https://api.anthropic.com/v1/models` call (see `src/main/anthropic-models.ts`), gated on a BYOK Anthropic API key being configured in Settings — this is a separate credential from the CLI's own OAuth session, so the resulting list reflects what the BYOK Anthropic account can access rather than the CLI session itself.

These lists appear in model dropdowns when the live/cached catalog is empty, in Settings default-model selection, the chat composer model selector, regenerate-with-model menus, `/models`, and the `Continue with...` fork dialog. CLI fallback lists appear in CLI-specific model selectors and are also used by main-process fork validation.

Best practice is to treat hardcoded models as offline fallbacks only. The preferred order is:

1. Backend-specific live discovery or cached provider/CLI data.
2. Persisted catalog snapshots from prior discovery.
3. Static seed/fallback lists only when discovery is unavailable.

All model sources now follow this hierarchy end-to-end:

- **OpenRouter**: `fetchAndCacheOpenRouterModels()` / `getOpenRouterModels()` in `src/main/provider-secrets.ts`, cached under the `openrouter_models_cache` settings key.
- **BYOK Anthropic + Claude CLI**: `fetchAndCacheAnthropicModels()` / `getCachedAnthropicModels()` in `src/main/anthropic-models.ts`, cached under the `anthropic_models_cache` settings key. Triggered on BYOK key save (`provider:set-key`), on successful key test (`testProviderKey`), and via a startup backfill in `registerModelAvailabilityHandlers()` if a key is configured but the cache is empty. The cache now feeds **both** the Claude CLI fallback and the BYOK Anthropic dropdown group (via `getProviderModelIds`).
- **BYOK OpenAI / Gemini / Azure**: `fetchAndCacheOpenAIModels()` / `fetchAndCacheGeminiModels()` / `fetchAndCacheAzureModels()` and `getCachedProviderModels()` in `src/main/provider-secrets.ts`, cached under `openai_models_cache` / `gemini_models_cache` / `azure_models_cache`. Same triggers as Anthropic (key save, key test, startup backfill). Gemini's OpenAI-shim `models/` id prefix is stripped so ids match registry spelling; Azure requires the endpoint to be configured before its deployments can be listed.
- **Codex CLI**: passive read of `~/.codex/models_cache.json`, refreshed by Codex itself — Nexy does not trigger this refresh.

Do not let hardcoded fallbacks bypass backend compatibility checks. Forking now validates selected agent/backend/model combinations in the main process and the renderer filters model options by selected backend.
