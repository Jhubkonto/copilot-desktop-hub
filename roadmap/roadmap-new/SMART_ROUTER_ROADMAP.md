# Smart Router + Response Rating — Implementation Roadmap

## Context

Nexy currently dispatches chat to either a CLI adapter (`claude-cli`, `codex-cli`, `gh-copilot`) or a BYOK provider (`openai`, `anthropic`, `azure`, `gemini`, `mistral`, `groq`, `xai`, `openrouter`) through a chain of hard-coded conditionals in `chat-handlers.ts`. There is no awareness of provider health, cost, or quality — if the chosen backend fails, the request errors immediately with no fallback.

This roadmap introduces:
1. **Smart Router** — a scoring + fallback engine that treats CLI adapters and BYOK providers as first-class, interchangeable backends, selects the best one per request based on health metrics and a configurable strategy, and retries through a ranked fallback chain on failure.
2. **Response Rating** — thumbs-up / thumbs-down per assistant message, stored in SQLite, feeding back into the router's quality scores to make the `quality-first` strategy self-improving.

Inspiration: OpenRouter's provider selection model (cost/latency/throughput/quality strategies, allow/deny/priority lists, fallback mechanics).

---

## Architectural Decisions

| Question | Decision |
|---|---|
| Where is router config stored? | Three-level cascade: conversation `router_config_json` → agent `routerConfig` field (inside `config_json` blob) → global `settings` key `smart_router_config` → `DEFAULT_ROUTER_CONFIG`. Matches existing model-resolution priority chain. |
| Metric collection: active or passive? | Passive only — instrument real requests. No synthetic pings (waste tokens, unreliable for CLI latencies). |
| How are CLI adapters unified with BYOK providers? | New `BackendDescriptor` type (`kind: 'cli' \| 'byok'`). Router scores all descriptors uniformly; dispatch layer still branches on `kind` but is driven by the router's output, not ad-hoc conditionals. |
| Quality score formula | EMA with α = 0.1 over normalized ratings (thumbs-up = 1.0, thumbs-down = 0.0 ± tag penalties). Neutral prior = 0.5 for unrated backends. |
| Rating UI placement | Below existing `MessageBubble` action bar, same hover guard, two `ActionButton`-style buttons (ThumbsUp / ThumbsDown), optional inline tag input. |

---

## Phase 0 — Foundation: Schema, Types, Unified Backend Model

**Goal:** Define all new DB tables, shared types, and IPC channels. No routing logic changes yet. Existing code path untouched.

### DB Migrations (append to `src/main/database-migrations.ts`)

**Migration 41 — `backend_health_metrics`**
```sql
CREATE TABLE IF NOT EXISTS backend_health_metrics (
  backend_id                  TEXT NOT NULL,
  model_id                    TEXT NOT NULL,
  sample_count                INTEGER NOT NULL DEFAULT 0,
  p50_latency_ms              REAL,
  p99_latency_ms              REAL,
  error_rate                  REAL NOT NULL DEFAULT 0.0,
  last_error_at               INTEGER,
  last_success_at             INTEGER,
  cost_estimate_per_1k_tokens REAL,
  updated_at                  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (backend_id, model_id)
);
```

**Migration 42 — `message_ratings`**
```sql
CREATE TABLE IF NOT EXISTS message_ratings (
  id              TEXT PRIMARY KEY,
  message_id      TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  model_id        TEXT,
  backend_id      TEXT,
  rating          INTEGER NOT NULL CHECK (rating IN (-1, 1)),
  tag             TEXT,
  routing_context TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_message_ratings_backend_model
  ON message_ratings(backend_id, model_id, created_at DESC);
```

**Migration 43 — conversation routing columns**
```sql
ALTER TABLE conversations ADD COLUMN router_config_json TEXT;
ALTER TABLE conversations ADD COLUMN routing_backend_id TEXT;
ALTER TABLE conversations ADD COLUMN routing_model_id TEXT;
```

**Migration 44 — `router_quality_scores`**
```sql
CREATE TABLE IF NOT EXISTS router_quality_scores (
  backend_id    TEXT NOT NULL,
  model_id      TEXT NOT NULL,
  ema_score     REAL NOT NULL DEFAULT 0.5,
  sample_count  INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (backend_id, model_id)
);
```

### New File: `src/shared/router-types.ts`

```typescript
export type RoutingStrategy =
  | 'auto' | 'lowest-cost' | 'highest-throughput' | 'lowest-latency' | 'quality-first'

export interface RouterConfig {
  strategy: RoutingStrategy
  priorityList?: string[]       // ordered backend_ids
  allowList?: string[]
  denyList?: string[]
  maxCostMultiplier?: number
  logicalModel?: string         // e.g. 'claude', 'gpt-4' — Phase 5
}

export interface BackendDescriptor {
  kind: 'cli' | 'byok'
  backendId: string             // 'claude-cli' | 'openai' | 'anthropic' | ...
  modelId: string
  supportsTools: boolean
  supportsImages: boolean
  isAvailable: boolean
  estimatedCostMultiplier?: number
}

export interface RoutingDecision {
  chosen: BackendDescriptor
  fallbackChain: BackendDescriptor[]
  strategyUsed: RoutingStrategy
  reason: string
}

export interface BackendHealthMetric {
  backendId: string; modelId: string
  sampleCount: number
  p50LatencyMs: number | null; p99LatencyMs: number | null
  errorRate: number
  lastErrorAt: number | null; lastSuccessAt: number | null
  costEstimatePer1kTokens: number | null
  updatedAt: number
}

export interface MessageRating {
  id: string; messageId: string; conversationId: string
  modelId: string | null; backendId: string | null
  rating: 1 | -1; tag: string | null
  routingContext: string | null; createdAt: number
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = { strategy: 'auto' }
```

### Updates to existing files

- **`src/shared/types.ts`** — add `routerConfig?: RouterConfig` to `AgentConfig`; add `router_config_json`, `routing_backend_id`, `routing_model_id` to `ConversationRow`; add new IPC channels to `IpcChannels` and `IpcReturnMap`:
  - `'rating:submit'` → `{ success: boolean }`
  - `'rating:get'` → `MessageRating | null`
  - `'router:get-stats'` → `BackendHealthMetric[]`
  - `'router:get-config'` → `RouterConfig`
  - `'router:set-config'` → `boolean`
- **`src/preload/index.ts`** — add `typedInvoke` wrappers for all five new channels

### Phase 0 Checklist

- [ ] Add migrations 41–44 to `database-migrations.ts`
- [ ] Create `src/shared/router-types.ts`
- [ ] Add `routerConfig?` to `AgentConfig` in `types.ts`
- [ ] Add `ConversationRow` columns in `types.ts`
- [ ] Add new IPC channels to `IpcChannels` + `IpcReturnMap` in `types.ts`
- [ ] Add `typedInvoke` wrappers in `src/preload/index.ts`
- [ ] Update `src/main/__tests__/database.test.ts` — assert new tables exist and DB version is 44

### Phase 0 Protocol Gate
```
npm run test          # migration test must pass
npm run typecheck     # no new TS errors
npm run lint          # no lint errors
npm run build         # must compile cleanly
```

---

## Phase 1 — Health Metric Collection (Passive Instrumentation)

**Goal:** Record latency and error/success outcome for every real request. Store results in `backend_health_metrics`. No routing changes.

### New File: `src/main/backend-health.ts`

Three exported functions:

**`recordSuccess(db, backendId, modelId, latencyMs)`**
- Read existing row. On first sample, set p50 = p99 = latencyMs.
- EMA update: `p50 = 0.1 * latencyMs + 0.9 * p50`; `p99 = 0.01 * latencyMs + 0.99 * p99`.
- Decay error rate: `error_rate = 0.9 * error_rate`.
- Increment `sample_count`, set `last_success_at`, upsert.

**`recordError(db, backendId, modelId)`**
- EMA update: `error_rate = 0.1 * 1.0 + 0.9 * error_rate`.
- Set `last_error_at`, upsert.

**`getHealthMetrics(db, backendId?)`** — SELECT all rows (optionally filtered) as `BackendHealthMetric[]`.

**`updateQualityScore(db, backendId, modelId, rating, tag?)`** (used in Phase 4 but defined here)
- Normalize: `score = rating === 1 ? 1.0 : 0.0`.
- Tag penalties: `'wrong'` → −0.2, `'hallucination'` → −0.2, `'too slow'` → −0.05 (clamp to 0).
- EMA: `ema_score = 0.1 * score + 0.9 * ema_score`, upsert into `router_quality_scores`.

### Instrumentation in `src/main/chat-handlers.ts`

Wrap CLI dispatch and BYOK dispatch each with:
```typescript
const t0 = Date.now()
try {
  const result = await <cli or byok call>
  recordSuccess(db, backendId, modelId, Date.now() - t0)
  ...
} catch (err) {
  recordError(db, backendId, modelId)
  throw err
}
```

After response completes, write back to conversation:
```sql
UPDATE conversations
SET routing_backend_id = ?, routing_model_id = ?
WHERE id = ?
```

### New File: `src/main/router-handlers.ts`

Register `registerRouterHandlers()` with:
- `router:get-stats` → `getHealthMetrics(db)`
- `router:get-config` → parse `settings` key `smart_router_config`
- `router:set-config` → write `settings` key

Add `registerRouterHandlers()` call in `src/main/ipc-handlers.ts`.

### Phase 1 Checklist

- [ ] Create `src/main/backend-health.ts` with `recordSuccess`, `recordError`, `getHealthMetrics`, `updateQualityScore`
- [ ] Instrument CLI dispatch block in `chat-handlers.ts` with timing + try/catch
- [ ] Instrument BYOK dispatch block in `chat-handlers.ts` with timing + try/catch
- [ ] Write `routing_backend_id` / `routing_model_id` back to conversation after response
- [ ] Create `src/main/router-handlers.ts` with config + stats handlers
- [ ] Register in `src/main/ipc-handlers.ts`
- [ ] Create `src/main/__tests__/backend-health.test.ts` — verify EMA math for p50/p99 and error_rate over 3+ samples

### Phase 1 Protocol Gate
```
npm run test
npm run typecheck
npm run lint
npm run build
```

---

## Phase 2 — Smart Router Core (Strategy, Scoring, Fallback Chain)

**Goal:** Replace the ad-hoc routing conditionals in `chat-handlers.ts` with a `SmartRouter` that scores all available backends and returns a ranked fallback chain.

### New File: `src/main/backend-catalog.ts`

**`buildBackendCatalog(selectedModel, db): BackendDescriptor[]`**

Iterates all configured backends:
- CLI: `ClaudeAdapter.isAvailable()`, `CodexAdapter.isAvailable()`, `GhCopilotAdapter.isAvailable()` — construct descriptor with correct `supportsTools` / `supportsImages` flags:
  - `claude-cli`: tools ✓, images ✓
  - `codex-cli`: tools ✓, images ✗
  - `gh-copilot`: tools ✓, images ✗
- BYOK: for each configured provider (has API key), use `modelIdSupportsTools()` from `src/shared/models.ts` and capability flags from the model catalog.

Returns one `BackendDescriptor` per available (backend, model) pair for `selectedModel`.

### New File: `src/main/smart-router.ts`

**`class SmartRouter`**

```typescript
resolve(
  candidates: BackendDescriptor[],
  config: RouterConfig,
  requestFeatures: { needsTools: boolean; needsImages: boolean },
): RoutingDecision
```

Steps:
1. Filter `isAvailable`.
2. Filter by `requestFeatures` (drop backends missing required capabilities).
3. Apply `allowList` / `denyList`.
4. Apply `maxCostMultiplier`.
5. Load `BackendHealthMetric[]` and `router_quality_scores` from DB.
6. Score each candidate by `strategy`:
   - `auto`: `0.4 × normLatency + 0.3 × (1 − errorRate) + 0.3 × (1 − normCost)`
   - `lowest-cost`: `0.9 × (1 − normCost) + 0.1 × (1 − errorRate)`
   - `highest-throughput`: `0.9 × (1/p50) + 0.1 × (1 − errorRate)` (normalized)
   - `lowest-latency`: `0.9 × (1/(p50+1)) + 0.1 × (1 − errorRate)` (normalized)
   - `quality-first`: `0.7 × qualityScore + 0.2 × (1 − errorRate) + 0.1 × normLatency`
   - All metrics normalized across candidate set before blending. Unrated → quality 0.5, no-metric → latency 0.5.
7. If `priorityList` set, promote those backends to front of sorted list.
8. Return `{ chosen: sorted[0], fallbackChain: sorted.slice(1), ... }`.

**Helper `resolveRouterConfig(db, agentId, conversationId): RouterConfig`**
- Reads conversation `router_config_json` → agent `routerConfig` from config blob → global `settings.smart_router_config` → `DEFAULT_ROUTER_CONFIG`.
- Can live in `smart-router.ts`.

### Integration in `chat-handlers.ts`

Replace the inline backend selection block (~lines 197–403) with:
```typescript
const routerConfig = resolveRouterConfig(db, effectiveAgentId, conversationId)
const catalog = buildBackendCatalog(selectedModel, db)
const requestFeatures = {
  needsTools: assignedMcpServers.length > 0 || wikiToolDefs.length > 0,
  needsImages: attachedImages.length > 0,
}
const decision = new SmartRouter(db).resolve(catalog, routerConfig, requestFeatures)
```

Then loop over `[decision.chosen, ...decision.fallbackChain]`, breaking on first success, re-throwing only if all fail.

### Phase 2 Checklist

- [ ] Create `src/main/backend-catalog.ts` with `buildBackendCatalog()`
- [ ] Create `src/main/smart-router.ts` with `SmartRouter` class and `resolveRouterConfig()`
- [ ] Replace routing block in `chat-handlers.ts` with SmartRouter integration
- [ ] Implement fallback chain loop — try next on error, propagate only when all fail
- [ ] Create `src/main/__tests__/smart-router.test.ts`:
  - Each strategy ranks a 3-candidate fixture correctly
  - `denyList` removes a backend
  - `priorityList` overrides score order
  - Fallback: when chosen throws, next candidate is tried
- [ ] Update mocks in `src/main/__tests__/chat.test.ts` for new routing path

### Phase 2 Protocol Gate
```
npm run test
npm run typecheck
npm run lint
npm run build
```

---

## Phase 3 — Response Rating UI + Data Pipeline

**Goal:** Add thumbs-up / thumbs-down rating to every assistant message. Store in DB, expose via IPC.

### New Renderer Component: `src/renderer/components/RatingBar.tsx`

```typescript
interface RatingBarProps {
  messageId: string
  existingRating?: 1 | -1 | null
  onRate: (messageId: string, rating: 1 | -1, tag?: string) => void
}
```

- Two `ActionButton`-style buttons using `ThumbsUp` / `ThumbsDown` from `lucide-react`.
- On click: set visual state, reveal a small inline tag input (optional).
- Confirm after tag input blur or 1.5 s with no input → call `onRate`.
- `existingRating` drives initial visual state (green up / red down).
- Uses the existing `ActionButton` pattern from `MessageBubble.tsx:303–329`.

### Integration in `src/renderer/components/MessageBubble.tsx`

- Add props: `existingRating?: 1 | -1 | null`, `onRate?: (messageId, rating, tag?) => void`
- Render `<RatingBar>` inside the `isAssistant && !isError && !isGenerating && showActions` block, below the existing action bar.
- Wire in parent (`ChatMessages.tsx` or `ChatWindow.tsx`): fetch existing rating when loading messages, call `window.api.invoke('rating:submit', ...)` on rate.

### Enriching Message Fetch

Extend the message-fetch SQL in `chat-handlers.ts` (or a dedicated handler) to LEFT JOIN `message_ratings` on `message_id`, returning `rating` and `tag` alongside each message. Avoids per-hover round trips.

### IPC Handlers (extend `src/main/router-handlers.ts`)

**`rating:submit`** — receives `{ messageId, conversationId, rating, tag? }`:
1. Look up message row → `model`, look up conversation → `routing_backend_id`.
2. Insert into `message_ratings`.
3. Call `updateQualityScore()` (Phase 4 completes this; stub it here to call through but no-op until Phase 4).
4. Return `{ success: true }`.

**`rating:get`** — returns `MessageRating | null` for a given `messageId`.

### Phase 3 Checklist

- [ ] Create `src/renderer/components/RatingBar.tsx`
- [ ] Add `existingRating` + `onRate` props to `MessageBubble`
- [ ] Render `<RatingBar>` inside assistant action bar section
- [ ] Enrich message fetch with LEFT JOIN on `message_ratings`
- [ ] Wire `onRate` in parent chat component
- [ ] Add `rating:submit` + `rating:get` handlers in `router-handlers.ts`
- [ ] Unit test `rating:submit`: inserts row, returns `{ success: true }`
- [ ] Unit test `rating:get`: null when unrated, row when rated
- [ ] Renderer test for `RatingBar`: thumbs-up click calls `onRate(messageId, 1)`
- [ ] Visual smoke test: send message, hover, confirm thumbs appear

### Phase 3 Protocol Gate
```
npm run test
npm run typecheck
npm run lint
npm run build
# Visual smoke test: dev server → send message → thumbs appear on hover
```

---

## Phase 4 — Rating → Router Feedback Loop (Quality Scoring)

**Goal:** Connect submitted ratings to `router_quality_scores` so the `quality-first` routing strategy self-improves over time.

### Activate `updateQualityScore()` in `rating:submit`

The function was defined in `backend-health.ts` in Phase 1. In Phase 3 it was called as a stub. Phase 4 fully activates it:

- `rating === 1` → `score = 1.0`; `rating === -1` → `score = 0.0`
- Tag penalties: `'wrong'` → −0.2, `'hallucination'` → −0.2, `'too slow'` → −0.05 (clamp ≥ 0)
- EMA: `ema_score = 0.1 × score + 0.9 × ema_score` (α = 0.1)
- Upsert into `router_quality_scores`

### Load Quality Scores in `SmartRouter`

Update `SmartRouter.resolve()` to query `router_quality_scores` for all candidate `(backendId, modelId)` pairs. Build a `Map<string, number>` (`'backendId:modelId'` → `ema_score`). Pass to `score()`. Unrated pairs → 0.5.

### Phase 4 Checklist

- [ ] Activate `updateQualityScore()` body (remove Phase 3 no-op stub)
- [ ] Update `SmartRouter.resolve()` to read and pass quality scores
- [ ] Unit test: one thumbs-down on `(openai, gpt-4o)` → scores lower than unrated peer under `quality-first`
- [ ] Unit test: five thumbs-up on `(claude-cli, claude-sonnet-4-6)` → scores higher than neutral
- [ ] Unit test: `'wrong'` tag → lower EMA than plain thumbs-down
- [ ] Regression: `auto` strategy unaffected by quality scores (quality score not in blend)

### Phase 4 Protocol Gate
```
npm run test
npm run typecheck
npm run lint
```

---

## Phase 5 — Advanced Routing (Feature-Aware + Model-Level Multi-Backend + Settings UI)

**Goal:** Accurate capability flags, logical model routing ("best claude"), and a settings UI to expose all router controls.

### Feature-Aware Capability Flags

Populate `supportsTools` / `supportsImages` accurately in `buildBackendCatalog()`:
- BYOK: use `modelIdSupportsTools(modelId, catalog)` from `src/shared/models.ts` and model catalog capability fields.
- CLI: hard-code known support matrix (see Phase 2 checklist).

The Phase 2 filter already uses these flags; Phase 5 ensures they are accurate rather than defaulted to `true`.

### Logical Model Routing

Add `logicalModel?: string` to `RouterConfig` (already declared in Phase 0 type as optional).

**`resolveLogicalModelCandidates(logicalModel, db): BackendDescriptor[]`** in `backend-catalog.ts`:
- Iterates BYOK providers → finds models matching the family prefix (e.g., `'claude'` matches `claude-*`).
- Checks CLI adapters → if the adapter's model list contains any matching model.
- Returns all `BackendDescriptor`s across matching (backend, model) pairs.

When `routerConfig.logicalModel` is set, pass the expanded catalog into `SmartRouter.resolve()`. `decision.chosen.modelId` becomes the actual model for that request.

### Settings UI: Routing Panel

Add a "Routing" section to `src/renderer/components/settings/GeneralTab.tsx` (or a new `RoutingTab.tsx`):
- Strategy selector (dropdown): Auto / Lowest Cost / Highest Throughput / Lowest Latency / Quality First
- Allow list / Deny list (multi-select of configured backends)
- Priority list (ordered, up/down arrow controls)
- Max cost multiplier (number input)
- Health metrics table (read-only): backend, p50 latency, error rate, quality score, sample count
- Data from `router:get-stats` + `router:get-config` on mount; saved via `router:set-config`

### Per-Agent Routing Overrides

Add a collapsible "Routing" section to `src/renderer/components/agent-panel/SettingsTab.tsx`:
- Strategy selector + allow/deny controls writing to `agent.routerConfig`
- Saved through existing `agent:update` IPC channel

### Phase 5 Checklist

- [ ] Populate `supportsTools` / `supportsImages` accurately in `buildBackendCatalog()`
- [ ] Implement `resolveLogicalModelCandidates()` in `backend-catalog.ts`
- [ ] Integrate logical model expansion into `SmartRouter.resolve()`
- [ ] Add routing panel to General Settings UI (`GeneralTab.tsx` or new tab)
- [ ] Add per-agent routing section to `agent-panel/SettingsTab.tsx`
- [ ] Unit test: `needsImages=true` → `gh-copilot` never selected
- [ ] Unit test: `logicalModel='claude'` → candidates include both `anthropic` BYOK and `claude-cli` when both configured
- [ ] E2E integration test: DB fixture with metrics + quality scores → `quality-first` picks correct winner

### Phase 5 Protocol Gate
```
npm run test
npm run typecheck
npm run lint
npm run build          # full build gate before shipping
# Visual smoke test: open settings → verify routing panel renders and saves
```

---

## Files Created / Modified Summary

| File | Status | Phase |
|---|---|---|
| `src/shared/router-types.ts` | **Create** | 0 |
| `src/main/backend-health.ts` | **Create** | 1 |
| `src/main/backend-catalog.ts` | **Create** | 2 |
| `src/main/smart-router.ts` | **Create** | 2 |
| `src/main/router-handlers.ts` | **Create** | 1 |
| `src/renderer/components/RatingBar.tsx` | **Create** | 3 |
| `src/main/__tests__/backend-health.test.ts` | **Create** | 1 |
| `src/main/__tests__/smart-router.test.ts` | **Create** | 2 |
| `src/shared/types.ts` | Modify | 0 |
| `src/preload/index.ts` | Modify | 0 |
| `src/main/database-migrations.ts` | Modify | 0 |
| `src/main/ipc-handlers.ts` | Modify | 1 |
| `src/main/chat-handlers.ts` | Modify | 1 + 2 |
| `src/renderer/components/MessageBubble.tsx` | Modify | 3 |
| `src/renderer/components/chat/ChatMessages.tsx` | Modify | 3 |
| `src/renderer/components/settings/GeneralTab.tsx` | Modify | 5 |
| `src/renderer/components/agent-panel/SettingsTab.tsx` | Modify | 5 |
| `src/main/__tests__/database.test.ts` | Modify | 0 |
| `src/main/__tests__/chat.test.ts` | Modify | 2 |

---

## Key Reusable Utilities (do not rewrite these)

- `getProviderForAgent()` — `src/main/provider-registry.ts` (still used to resolve model→provider within `buildBackendCatalog`)
- `modelIdSupportsTools()` — `src/shared/models.ts` (used in capability flag population)
- `ActionButton` component — `src/renderer/components/MessageBubble.tsx:303–329` (reused in `RatingBar`)
- `safeHandle()` — `src/main/safe-handle.ts` (required for all new IPC handlers)
- `ClaudeAdapter.isAvailable()`, `CodexAdapter.isAvailable()`, `GhCopilotAdapter.isAvailable()` — `src/main/cli-adapters/` (used in `buildBackendCatalog`)
