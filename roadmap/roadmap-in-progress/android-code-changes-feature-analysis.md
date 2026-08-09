# Android "Code Changes" Feature — Integration, Flow, and Ease-of-Use Analysis

Status: **research report**, not a roadmap. No code was changed producing this document. All file:line citations reflect the codebase at the time of writing (2026-07-12). Scope: the Android implementation of "Code Changes," with the desktop/main-process side covered only as needed for context and parity comparison.

## 1. What this feature is

"Code Changes" is the user-facing name for a full AI-assisted repo-editing workflow: a user describes a change (edit / refactor / bugfix / feature / investigation / custom), an LLM plans it, generates a staged patch, the user reviews per-file diffs, applies the patch to the connected desktop workspace, runs verification (typecheck/lint/test/build), and commits/pushes via git — with delete, undo/rollback, and plan-revision available throughout.

Internally the feature is still named `self-heal` / `remote-edit` / `error_reports` — it began life as an app-self-repair mechanism ("Nexy fixes itself") and was deliberately reframed into a general-purpose, repo-connected editing feature. This history is documented in two completed archived roadmaps (`roadmap/roadmap-archive/CODE_CHANGES_REFRAME_ROADMAP--COMPLETE.md`, `CODE_CHANGES_OVERHAUL_ROADMAP--COMPLETE.md`) and a living compatibility note (`docs/code-changes-compatibility.md`). The rename is presentation-only by design: DB table (`error_reports`), IPC channels (`remote-edit:*`), and Android's WS commands (`self-heal:*`, `error-report:*`) were deliberately kept as internal plumbing rather than renamed, to avoid cross-platform churn.

Git history shows this is an actively-worked area — as recently as the last few days (`432d19d`, `76f2b12`) planning-settings picker bugs were still being fixed on Android.

## 2. End-to-end architecture

```
Android (Compose)                       Desktop (Electron main)
─────────────────────                    ───────────────────────
RemoteEditStartScreen ──create──▶  error-report:request-capture ─▶ createErrorReport()
                                                                     (error_reports row)
RemoteEditReportDetailScreen                remote-edit/investigator.ts
  ├─ "Plan change" ───────────────▶ self-heal:start-investigation ─▶ LLM planning loop
  ├─ Accept/Reject/Revise plan                                        (streamed activity)
  ├─ "Generate staged patch" ─────▶ self-heal:start-fix ────────────▶ remote-edit/fix-agent.ts
  │                                                                    (LCS line-diff engine,
  │                                                                     writes remote_edit_diffs)
  ├─ per-file diff review/"Mark reviewed"
  ├─ "Apply patch" ────────────────▶ self-heal:apply-staged-patch ──▶ applyStagedPatchToWorkspace()
  ├─ "Run verification" ───────────▶ self-heal:start-verification ─▶ remote-edit/verifier.ts
  ├─ "Push" ───────────────────────▶ self-heal:git-push
  └─ "Undo this change" ───────────▶ self-heal:request-rollback ───▶ recovery.ts (backup restore)
```

Every step broadcasts progress to Android via `broadcastToMobile()` in `src/main/ws-server.ts`. A deliberate compatibility shim — a `MOBILE_EVENT_NAMES` translation table duplicated in `fix-agent.ts`, `investigator.ts`, and `verifier.ts` — rewrites desktop's internal `remote-edit:*` IPC channel names into the `self-heal:*` names Android's `WsEventParser.kt` still expects, since Android's wire protocol was never renamed alongside the desktop UI. This is explicitly commented in the code as a known, intentional translation point — worth knowing about if a future channel is added and mobile silently stops receiving it.

**Diff engine**: the desktop computes diffs itself using a custom LCS (longest-common-subsequence) line differ (`src/main/remote-edit/fix-agent.ts`, `buildLcsTable`/`tracebackLcs`/`groupIntoHunks`) — not a third-party diff library, and not parsing an existing unified-diff/patch file. It produces `DiffHunk[]` with unified-diff-style headers, serializes them to JSON, and sends that JSON to Android verbatim. **Android is a pure renderer, not a parser**: `DiffViewer.kt`'s `renderDiffHunks()` converts the structured hunk JSON back into `+`/`-`/` `-prefixed text for a simple colored monospace view (`NexyDiffContent`) — no side-by-side mode, no syntax highlighting. That's an appropriately scoped choice for a phone screen, not a defect.

## 3. Android file inventory

| File | Role |
|---|---|
| `ui/remoteedit/RemoteEditViewModel.kt` (216 lines) | Thin proxy over the `WsRepository` singleton; owns busy-state flows (`isApplying`, `verificationRunning`, `gitPushRunning`, `rollbackRunning`, `deletingReportId`), verification/recovery run history maps, and a unified `actionResults` toast channel. |
| `ui/remoteedit/RemoteEditStartScreen.kt` (187 lines) | New-request form: title, description, request type dropdown, custom label. Single-shot submit — no separate confirm/review screen. |
| `ui/remoteedit/RemoteEditReportsScreen.kt` (277 lines) | List view: search, status filter chips, pull-to-refresh, phase badges, per-row delete. |
| `ui/remoteedit/RemoteEditReportDetailScreen.kt` (1,409 lines) | The core screen: phase stepper, plan review (Accept/Reject/Revise), staged-file diff tree, apply/verify/push/undo actions, collapsible planning-settings card. |
| `data/model/CodeChangePhase.kt` (77 lines) / `CodeChangeRequestType.kt` (39 lines) | Kotlin ports of `src/shared/code-changes.ts`'s phase-derivation and request-type logic, each guarded by a JUnit fixture test against drift. |
| `data/WsRepository.kt` / `WsEventParser.kt` / `data/model/WsEvent.kt` | WS command senders and event parsers for all `self-heal:*` / `error-report:*` / `project-audit:*` traffic. |
| `ui/components/DiffViewer.kt` (91 lines) / `FileTreeView.kt` (264 lines) | Shared diff-rendering and folder/file tree primitives used by the detail screen and the separate Project Audit screen. |
| `navigation/NavGraph.kt` | Registers `project-code-changes/{projectId}` (list), `.../new?prefill=` (create), `remote-edit/{reportId}` (detail). |

Tests: `RemoteEditViewModelTest.kt` (6 cases, solid coverage of delete/apply/verify/push/rollback state), `CodeChangePhaseFixtureTest.kt` (14 cases mirroring TS branches), `CodeChangeRequestTypeFixtureTest.kt` (3 cases), `RemoteEditActiveCodeChangesParserTest.kt` (parser correctness for a feature whose UI was since deleted — see §4.1).

## 4. Findings

### 4.1 The Code Changes list screen has no reachable entry point (confirmed regression)

This is the most impactful finding. `RemoteEditReportsScreen` (the list of all Code Changes for a project) is registered as a nav route but **nothing in the current codebase navigates to it**. Verified directly:

- `grep` for `project-code-changes` in `NavGraph.kt` showed the route registered in [NavGraph.kt](../../android/app/src/main/java/io/nexy/android/navigation/NavGraph.kt), with exactly one call site — the list screen's own "new request" FAB navigating *within itself*. No external screen called into it when this analysis was written.
- The only two ways to reach *any* Code Changes screen today are: (1) chat's "create code change" action, which prefills and jumps straight to the **new-request** form, bypassing the list entirely; (2) tapping an inline `CodeChangeRefBubble` chat card that deep-links to one already-known report's detail screen.
- Once created, a request's detail screen has no "back to list" affordance either — a user who navigates away has no way back except re-finding the same chat message.

Git history shows this used to work: commit `c0ee1c3` ("improve project code change workflow") added a per-project Code Changes icon button to each project row in `ProjectsTab` (`HomeScreenTabs.kt`), gated on the project having a `rootDirectory`, with a live spinner+count badge (`activeCodeChangesByProject`) and a "Set up this project" prompt when ungated. Commit `6e318ea` ("feat(android): polish generated artifact screens" — 2026-07-07), whose stated purpose is unrelated (artifacts/quiz/debrief screens), **deleted all of it**: the icon button, its `IconButton`/`Icons.Default.Difference` import, the badge `Surface`, the `setupPromptProject` dialog, and the `connectionState`/`activeCodeChangesByProject`/`onOpenCodeChanges` parameters from `ProjectsTab`'s signature — confirmed by direct diff inspection. This has every hallmark of accidental collateral deletion (e.g. a stale branch merge) rather than an intentional design decision — there is no roadmap entry, changelog note, or commit message anywhere explaining a decision to remove it.

The underlying data plumbing this UI used to consume (`activeCodeChangesByProject`, `self-heal:get-active-code-changes` / `self-heal:active-code-changes-changed`) is still present, working, and still covered by a passing test (`RemoteEditActiveCodeChangesParserTest.kt`) — it just has zero UI consumers now. This makes it a comparatively cheap fix: the entry point needs to be re-added to `ProjectsTab`/`HomeScreenTabs.kt` and wired through `HomeScreen.kt`/`NavGraph.kt`, not rebuilt from scratch.

### 4.2 Phase-derivation logic has drifted from desktop (Kotlin missing one branch)

`src/shared/code-changes.ts`'s `deriveCodeChangePhase()` has this branch (line 75):
```ts
if (report.status === 'open' && report.investigation_root_cause === 'investigation_failed') return 'draft'
```
This exists specifically to fix a documented dead-end (`docs/code-changes-compatibility.md`, "Planning settings dead end fixed"): a request whose last planning attempt failed reverts `status` to `'open'` for retry, but `investigation_markdown` stays populated with the failure doc — without this branch, the phase deriver would misread that as "Planning" (`investigating`) rather than "Draft," hiding the retry affordance.

`android/app/src/main/java/io/nexy/android/data/model/CodeChangePhase.kt`'s `deriveCodeChangePhase()` (lines 45-64) does not have this branch — confirmed by direct read. Every other branch matches the TS source line-for-line, including order. Practical effect: on Android, a request whose planning just failed is mis-derived as **"Planning"** instead of **"Draft"** in both the list badge and the detail screen's phase stepper — even though the detail screen's separate hand-rolled `planFailed` check still correctly shows a "Planning failed" card and retry button. The phase pill visibly contradicts the failure messaging right next to it, rather than the feature being broken end-to-end.

Notably, `CodeChangePhaseFixtureTest.kt` — the explicit drift-guard test this codebase built for exactly this class of bug — has no test case for the `investigation_failed` scenario, which is presumably how the drift went unnoticed. This is worth flagging on its own: the guard-test pattern is good discipline, but its coverage has a gap.

### 4.3 Custom request type is write-only — never displayed after creation

`RemoteEditStartScreen` lets a user pick `CUSTOM` and type a free-text label, and it's sent correctly over the wire (`error-report:request-capture` with `requestType`/`customTypeLabel`). But `ErrorReport` (the Kotlin model backing every screen) has no `requestType`/`customTypeLabel` fields, and `WsEventParser.kt`'s `self-heal:reports` parsing never reads those fields off the wire payload. So after creation, the chosen request type is never shown anywhere again — not in the list, not in the detail header. The correctly-ported `codeChangeRequestTypeLabel()` helper (tested, drift-guarded) has zero call sites in any screen. There's also no way to filter the list by request type, only by raw status string.

### 4.4 Verification step has no live progress feed (asymmetric with planning)

`WsEvent.RemoteEditVerificationEvent` carries `command`/`status`/`label`/`line` — clearly designed to stream per-command progress (e.g. "Running typecheck…", live output), mirroring how planning already streams an activity feed + markdown chunks. Neither `RemoteEditViewModel` (which only uses the event to flip a boolean that's already true) nor `RemoteEditReportDetailScreen` (which doesn't collect this event type) surfaces any of that data. During a multi-command run (typecheck/lint/test/build by default), the user sees a static "Verifying…" label with no indication of which command is running or its output — noticeably worse than the planning phase's experience, for what can be the longest-running step in the workflow.

### 4.5 Smaller gaps

- **Dead client code**: `WsRepository.remoteEditGitCommit()` and `WsEvent.RemoteEditGitCommitResult` exist (added in `a385ad5`) but have zero UI call sites — consistent with commit composition being desktop-only, but the unused plumbing could mislead a future contributor into assuming commit-from-Android already works.
- **Workspace-mismatch banner is desktop-only, undocumented as such**: `docs/code-changes-compatibility.md`'s UX-overhaul list mixes cross-platform items with desktop-only ones without clearly separating them — the workspace-mismatch warning banner has no Android equivalent (`ErrorReport` doesn't even carry a `workspaceRoot` field), but a reader could easily assume otherwise from the doc's phrasing.
- **List can't show late-stage phases**: `RemoteEditReportsScreen`'s badge calls `deriveCodeChangePhase(report)` without verification/commit data (list rows only fetch `ErrorReport`), so a committed or verifying request always displays as "Applied" in the list even though the detail screen (which does fetch that data) shows the correct phase. This looks like an intentional list/detail simplification, not a bug — distinct from §4.2's genuine drift.
- **No per-row busy indicator**: ties back to §4.1 — the same lost `activeCodeChangesByProject` data could drive a spinner on in-progress rows (matching desktop's `CodeChangeListView` "Background-run visibility" feature) but no longer has any UI consumer.
- **Doc/code route mismatch**: `docs/code-changes-compatibility.md` describes the chat deep link as `remote-edit/start?prefill=...`; the actual route is `project-code-changes/{projectId}/new?prefill=...`. Likely stale documentation from before the feature became project-scoped (`c0ee1c3`), not a functional bug.

## 5. What's genuinely solid

Worth stating plainly so the findings above aren't mistaken for "the feature is broken": once a user is inside a request's detail screen, Android has near-complete functional parity with desktop — plan/accept/reject/revise (with an inline model picker for re-planning), staged per-file diff review with a real folder tree and "mark reviewed" gating, apply-to-workspace, verification, git push, and undo/rollback, all match desktop's phase model and guidance text. The `RevisePlanControl` composable, the tappable `PhaseStepper` with scroll-to-section, and the immediate "Starting…" placeholder for live planning feedback are thoughtful, deliberate UX work, not afterthoughts. Recent commits (`432d19d`, `76f2b12`) show this area is still being actively debugged and polished (fixing a free-text model field into a proper picker, filtering CLI backends to what's actually installed, gating screens behind connection state to avoid infinite spinners when disconnected).

The gap is not depth of functionality — it's **discoverability** (§4.1) and a handful of **display-layer inconsistencies** (§4.2–4.4) sitting on top of an otherwise mature backend workflow.

## 6. Suggested priority if this becomes implementation work

1. **Restore the Code Changes entry point** (§4.1) — highest impact, lowest cost, since the backend/data layer never regressed. Re-add the icon/badge to `ProjectsTab` (or an equivalent discoverable location) and wire `onOpenCodeChanges` back through `HomeScreen.kt` → `NavGraph.kt` → the existing `project-code-changes/{projectId}` route.
2. **Port the missing phase-derivation branch** (§4.2) into `CodeChangePhase.kt`, and add the missing fixture case to `CodeChangePhaseFixtureTest.kt` so the guard actually covers it this time.
3. **Decide on request-type display** (§4.3): either surface it (parse `request_type`/`custom_type_label` into `ErrorReport`, show it in list/detail) or accept it's Android-invisible by design and document that explicitly — leaving it silently write-only is the worst of both options.
4. **Wire verification progress** (§4.4) into the detail screen the same way investigation activity already streams, reusing the event fields that already exist on the wire.
