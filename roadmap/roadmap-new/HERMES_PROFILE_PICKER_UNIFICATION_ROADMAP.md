# Hermes Profile Picker — Cross-Client Unification Roadmap

**Milestone:** UI Unification (standardize UX across desktop + Android)
**Depends on:** `ACP_AGENT_RUNTIME_IMPLEMENTATION_ROADMAP.md` (H4 — Readiness & minimal UX). This plan *is* the concrete H4 delivery for profiles + readiness.
**Author basis:** grounded assessment of the live ACP adapter (`src/main/cli-adapters/hermes-acp.ts`), desktop config UI (`SettingsTab.tsx`), Android config UI (`AgentConfigScreen.kt`), WS sync (`ws-handlers.ts`), CLI detection (`cli-detection.ts`), and the Hermes source repo v0.17.0.

---

## Problem statement

Hermes runs over ACP and is the default Hermes backend. A profile is a fully isolated `HERMES_HOME` (`~/.hermes/profiles/<id>`) with its own `.env`, model, provider, skills, memory, and `SOUL.md`. Nexy launches `hermes --profile <name> acp` and the session key already includes the profile, so "new profile = new process" works correctly.

But the UX is inconsistent and lossy across clients:

1. **Desktop** exposes a **free-text** profile input (`SettingsTab.tsx:152`) — users must know and type a magic string; no discovery, no validation against reality.
2. **Android has no profile field at all.** The Android `AgentFullConfig` model carries no `hermesProfile`, `buildAgentUpdatePayload` never sends it, and `AgentConfigScreen.kt` has no UI — so editing a Hermes agent on Android **silently drops** any profile the desktop set.
3. **Validation mismatch:** desktop `pattern="[A-Za-z0-9_-]+"` accepts `Coder`; Hermes' real rule is `^[a-z0-9][a-z0-9_-]{0,63}$` (lowercase, alphanumeric start, ≤64). Passing desktop validation ≠ valid profile → silent spawn failure at first turn.
4. **Readiness = "binary exists"** (`isAvailable()` = `resolveCliPath('hermes') !== null`), not "ACP ready." Installed-but-uncredentialed Hermes looks available and fails on the first prompt.
5. **Stale copy:** backend label still reads "Hermes Agent (hermes -z)" on both clients though the path is ACP.

**Goal:** both clients pick a named, self-describing profile from a **live list** (model/description as subtext), with matching validation, graceful unknown-profile fallback, and readiness that means ACP-ready. Standalone Android (no desktop, no CLI) hides the picker.

---

## Decision gate (must resolve before Phase 0)

From the ACP roadmap "Open decisions":

- **D1 — Configuration inheritance (BLOCKING the *meaning* of a profile).** ACP sessions currently inherit the user's real Hermes home/memory/skills (the ACP path does *not* pass `--ignore-user-config --ignore-rules`, unlike legacy `hermes.ts:42`). The profile picker only makes sense if we keep "profile = real isolated Hermes home." **Recommendation: keep inheritance (embrace native profiles).** This plan assumes that answer. If we instead want a sandboxed home, the picker enumerates a different source and this plan's Phase 1 changes.
- **D3 — Legacy `-z` exposure.** Not blocking; addressed cosmetically in Phase 2 (relabel) and optionally hidden behind a dev flag. No code path removal in this plan.

**Do not start Phase 1 until D1 is confirmed.** Everything else can proceed.

> **D1 RESOLVED (2026-08-07): keep native profile inheritance.** Nexy-launched Hermes ACP sessions continue to inherit the selected profile's real `~/.hermes/profiles/<name>` home — memory, skills, SOUL.md. Added requirement: this inheritance must be **disclosed in-app** so users understand the picked profile brings its own memory/skills into the session (not a sandbox). See Phase 2.5 (desktop) and Phase 3.4 (Android).

---

## Architecture at a glance

```
Main process
  cli-detection.ts
    ├─ listHermesProfiles()      NEW  → scan ~/.hermes/profiles/* (+ parse each config.yaml)
    └─ hermesAcpReadiness()      NEW  → `hermes acp --check`/`--version`, cached, manual recheck
        │
        ├─ IPC  hermes:list-profiles / hermes:acp-readiness   (desktop)
        └─ WS   app:cli-status extended with hermes.profiles + readiness   (Android)

Desktop  SettingsTab.tsx      free-text input  → <select> from IPC
Android  AgentConfigScreen.kt (nothing)        → dropdown from WsRepository, connected-mode only
Shared   validateHermesProfileName()  NEW in src/shared/  (single source of truth)
```

---

## Phase 0 — Shared foundation (no user-visible change)

**0.1 Canonical validator.** Add to `src/shared/utils.ts` (or a new `src/shared/hermes.ts`):
```ts
export const HERMES_PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
export function isValidHermesProfile(name: string): boolean
```
Mirror the exact Hermes rule (`profiles.py:37`). Kotlin gets a twin constant in a shared UI util (Android can't import TS) — keep them commented as "must match `HERMES_PROFILE_RE`."

**0.2 Profile type.** Add to `src/shared/types.ts`:
```ts
export interface HermesProfileInfo {
  name: string
  isDefault: boolean
  model?: string
  provider?: string
  description?: string   // from SOUL.md first line or config
}
```

**Tests:** `src/shared/__tests__` — validator accepts `default`, `localllm-iso`; rejects `Coder`, `-x`, 65-char, empty.

---

## Phase 1 — Main process: enumerate + readiness *(gated on D1)*

All in `cli-detection.ts`, following the existing `readHermesConfigModels()` / `getCliModels()` pattern.

**1.1 `listHermesProfiles(): HermesProfileInfo[]`**
- Scan `~/.hermes/profiles/*` directories (equally viable to `hermes profile list`, which has no `--json`; dir scan avoids a subprocess + timeout on the hot path).
- Always synthesize a `default` entry (isDefault: true) even if the dir is absent — that's the no-`--profile` case.
- For each, reuse the existing YAML helpers (`extractYamlBlock`/`readYamlScalar`) against `<profile>/config.yaml` for model/provider; read first non-empty line of `<profile>/SOUL.md` for `description` (bounded read).
- Wrap in try/catch → `[]`-safe, exactly like `readHermesConfigModels()`.

**1.2 `hermesAcpReadiness()`** (delivers ACP roadmap H4 §313–324)
- Run `hermes acp --check` and `hermes acp --version` via `spawnSync` with **strict short timeouts** (≤3s), `shell:false`.
- Return `{ ready: boolean; version?: string; detail?: string }`.
- **Cache** success; invalidate when the resolved executable path/version changes; expose a manual recheck (the IPC/WS call re-runs on demand).
- Fold into detection: extend the `hermes` entry in `detectAllClis()` (or a sibling) so "available for selection" can mean ACP-ready, not just present. Keep `isAvailable()` on the adapter as-is for the legacy model-list path; gate *selection UX* on readiness.

**1.3 IPC (per CLAUDE.md 4-step pattern):**
1. `IpcChannels` union += `'hermes:list-profiles'`, `'hermes:acp-readiness'` (`src/shared/types.ts`).
2. `IpcReturnMap` += `HermesProfileInfo[]` and the readiness shape.
3. `typedInvoke` wrappers in `src/preload/index.ts`.
4. `safeHandle('hermes:list-profiles', …)` + `safeHandle('hermes:acp-readiness', …)` registered in `registerCliHandlers()` (`cli-detection.ts:249`).

**Tests (`src/main/__tests__/`):** temp `HOME` with fixture `profiles/` dirs → assert enumeration, default synthesis, YAML/SOUL parsing, and graceful empty. Mock `spawnSync` via `vi.hoisted` (per CLAUDE.md ESM rule) for readiness timeout / non-zero exit (H4 §454).

---

## Phase 2 — Desktop UI

**2.1 Replace free-text with dropdown** (`SettingsTab.tsx:149–161`):
- On mount / when `backend === 'hermes-cli'`, call `window.api` → `hermes:list-profiles`; render `<select>` styled like the sibling "Response Format"/"Chat Backend" selects (2.x lines 111–135) for visual consistency.
- Options: `default (normal Hermes profile)` + each profile showing `name` with model/description as muted subtext (option label; optional richer custom dropdown deferred to keep scope tight).
- Value stored in `config.hermesProfile` exactly as today (`undefined` for default). Keep the "changing it starts a new Hermes session" helper text.
- **Graceful degradation:** if the list is empty or the IPC errors (Hermes not installed / not ready), fall back to the **existing free-text input** with the corrected `pattern` — never leave the user unable to type a profile.
- If the stored `hermesProfile` isn't in the live list (renamed/removed), show it as a distinct "⚠ unknown profile — will fall back to default" option rather than dropping it silently.

**2.2 Fix validation:** replace `pattern="[A-Za-z0-9_-]+"` with `HERMES_PROFILE_RE` source, and validate via the shared `isValidHermesProfile` on change.

**2.3 Relabel** `SettingsTab.tsx:134` "Hermes Agent (hermes -z)" → "Hermes Agent (ACP)".

**2.4 Readiness surfacing (light):** if `hermes:acp-readiness` returns not-ready while `hermes-cli` is selected, show an inline note ("Hermes is installed but not ACP-ready — check credentials") next to the existing "Setup instructions" affordance. No blocking.

**2.5 Inheritance disclosure (D1 requirement):** near the profile picker, show a persistent muted helper line making the inheritance explicit, e.g. *"Nexy runs Hermes with this profile's own home — its memory, skills, and SOUL.md carry into every session. Profiles are managed in the Hermes CLI."* This is the primary in-app flag for the kept-inheritance decision.

**Tests (`src/renderer/__tests__` + `src/test/mocks/api.ts`):** add `hermes:list-profiles`/`hermes:acp-readiness` stubs; assert dropdown renders options, selection updates field, empty-list falls back to text input, unknown-profile warning renders.

---

## Phase 3 — Android (the real unification work)

Android is a **companion** and cannot run `hermes` locally → the list must arrive **over WebSocket from desktop**.

**3.1 Carry the field end-to-end.**
- `AgentFullConfig.kt` (+ `Agent.kt` if summary needs it) += `val hermesProfile: String? = null` (next to `backend`/`cliModel` at line 8–9).
- `AgentConfigPayload.kt` `buildAgentUpdatePayload` += `put("hermesProfile", config.hermesProfile ?: "")` (mirrors `cliModel` handling at line 42).
- Desktop side already reads `data.hermesProfile`? Verify `ws-handlers.ts` agent-update patch (`~line 2135`, where `backend` is patched) also patches `hermesProfile` — **add it if missing** so Android edits round-trip. This is the concrete data-loss fix.

**3.2 Push the profile list to Android.**
- Extend the `app:cli-status` broadcast (`ws-handlers.ts:2216`, `detectAllClis()`) — or a sibling event — to include `hermes: { profiles: HermesProfileInfo[], acpReady: boolean, version? }`.
- Android `WsEvent.CliStatus` (`WsEvent.kt:409`) / its `CliInstallInfo` gains the profile list + readiness; surface via `WsRepository` as a `StateFlow` alongside `cliStatus`/`models`.

**3.3 UI dropdown** in `AgentConfigScreen.kt`:
- Render a profile picker (reuse the existing `ModelPickerSheet`/dropdown idiom already imported at line 71, matching the backend/model selectors) **only when** `backend == "hermes-cli"`.
- Populate from the WS profile list; same "default + named profiles w/ model subtext" presentation as desktop for UX parity.
- **Standalone-mode guard:** hide/disable the picker when not in connected mode (no desktop → no Hermes → profile meaningless). Follow the existing connected-vs-standalone gating already used in this screen.
- Unknown stored profile → same "⚠ unknown, falls back to default" treatment as desktop.

**3.4 Inheritance disclosure (D1 requirement):** mirror desktop 2.5 — a muted helper line under the Android profile picker stating the profile's own memory/skills/SOUL.md carry into each session, so the disclosure is consistent across both clients (UI-unification goal).

**Tests:** Android instrumentation/unit for payload round-trip (`hermesProfile` present in `buildAgentUpdatePayload`), dropdown visibility gated on backend + connected mode, and profile-list rendering from a stubbed `WsRepository`.

---

## Phase 4 — Robustness & cleanup

**4.1 Graceful unknown profile at runtime** (`hermes-acp.ts:51–55`): if a stored profile no longer exists on disk, either (a) surface a visible warning event and fall back to `default`, or (b) let Hermes fail but map the error to a clear user-facing message rather than a raw spawn error. Prefer (a) — validate against `listHermesProfiles()` before spawn.

**4.2 Docs:** note the profile picker + readiness in the ACP roadmap H4 checklist; mark H4 items §405–409 done.

**4.3 Optional (D3):** gate legacy `hermes -z` selection behind a dev flag. Out of default scope.

---

## Out of scope

- Creating/editing/deleting Hermes profiles from Nexy (Nexy consumes profiles; management stays in the Hermes CLI).
- The sandboxed-home alternative to D1.
- Per-conversation profile override (profile stays an agent-level config, consistent with today).

---

## Validation gates (run before commit)

`npm run typecheck && npm run lint && npm test`; Android `./gradlew :app:assembleDebug` + relevant unit tests. Use the `nexy-app-check` skill for a connected-mode smoke test: set a Hermes profile on desktop, confirm it appears + persists on Android and that switching spawns a fresh ACP session.

---

## Suggested sequencing / PRs

1. **PR-0 ✅ DONE:** Phase 0 (shared validator + type) — safe, no behavior change.
2. **PR-1 ✅ DONE:** Phase 1 (main-process enumeration + readiness + IPC) — *D1 confirmed*.
3. **PR-2 ✅ DONE:** Phase 2 (desktop dropdown + validation + relabel + 2.4 readiness note + 2.5 inheritance disclosure). `SettingsTab.tsx` now fetches `hermes:list-profiles`/`hermes:acp-readiness` when the Hermes backend is selected, renders an enumerated `<select>` (graceful free-text fallback + unknown-profile warning + shared `isValidHermesProfile` validation), relabels the backend option to "Hermes Agent (ACP)", and shows the kept-inheritance disclosure. Tests: `SettingsTab.test.tsx` (16 pass). Gates: test ✓ typecheck ✓ lint ✓.
4. **PR-3 ✅ DONE:** Phase 3 (Android field round-trip + WS list + dropdown) — the unification payoff. Desktop `ws-handlers.ts` now patches `hermesProfile` on agent-update (`:2138`) and rides the profile list + ACP readiness along the `app:cli-status` reply (`:2217`, via `listHermesProfiles`/`hermesAcpReadiness`). Android gained `HermesProfile.kt` (Kotlin twin of `shared/hermes.ts`: `HERMES_PROFILE_RE`, `HermesProfileInfo`, `HermesCliInfo`), a `hermesProfile` field on `AgentFullConfig` + payload + parser round-trip, a `hermesInfo` `StateFlow` on `WsRepository` fed by the parsed `hermes` block, and a backend-gated `HermesProfileField` dropdown in `AgentConfigScreen.kt` — connected-only (muted note + `getCliStatus()` on load in standalone), unknown-profile warning, and the Phase 3.4 inheritance disclosure mirroring desktop. Tests: `AgentConfigRoundTripTest` (green). Gates: Android `testDebugUnitTest` BUILD SUCCESSFUL ✓ (Kotlin main+test compile), desktop typecheck ✓ lint ✓.
5. **PR-4 ✅ DONE:** Phase 4 (runtime fallback + docs). `hermes-acp.ts` now validates a stored profile against `listHermesProfiles()` before spawn (4.1): an unknown/deleted profile emits an `activity` warning (`Hermes profile "<name>" not found — using default`) and falls back to `default` (no `--profile` flag) instead of a raw spawn failure; `default` is always synthesized so the fallback never fails. Docs: ACP roadmap H4 deliverables marked (readiness probe/label/copy done; full connecting/interrupted state set noted open). 4.3 (dev-flag hiding of legacy `-z`) left out of scope. Tests: `hermes-acp.test.ts` gains a fallback case (gone profile → `['acp']` + warning event). **Gates:** typecheck ✓ (my files clean — only error tree-wide is the unrelated `skills.ts → ./skill-discovery` missing-file breakage from the concurrent Agent Skills rework), lint ✓; `hermes-acp.test.ts` cannot *execute* until that unrelated `skill-discovery.ts` lands (its module graph reaches `skills.ts`; the unmodified baseline fails identically, confirming it's not from this change), while `hermes-detection.test.ts` — which exercises the real `listHermesProfiles` — passes.

Each PR independently shippable; PR-3 depends on PR-1's WS extension.
