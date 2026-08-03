# Roadmap: UI Unification — 8-Bit Visual Restyle

Drafted 2026-07-31. **Status: IN PROGRESS.**

## Implementation progress

### Slice 1 — shared theme foundation (completed 2026-07-31)

- Added the cross-platform source of truth at `design/nexy-8bit-theme.json`.
- Added deterministic desktop CSS and Android Compose color generation with a stale-output check.
- Connected the Paper Terminal and Midnight Computer roles to Tailwind and Material 3.
- Replaced the legacy neutral ramps with the Command Office neutral palette.
- Unified project colors across desktop and Android, including `teal` → `cyan` and `indigo` → `purple` compatibility aliases.
- Tightened Android theme corner shapes without changing component bounds or touch targets.
- Verified desktop typecheck/build and Android production Kotlin compilation.

Next slice: capture the geometry baseline, then restyle shared desktop and Android primitives using the new semantic roles.

### Slice 2 — geometry baseline and shared primitives (completed 2026-07-31)

- Documented the frozen desktop measurements, Android touch/layout invariants, and reproducible visual-review matrix in `docs/ui/8bit-baseline/README.md`.
- Restyled desktop modals, confirmations, buttons, cards, fields, toggles, tabs, pane controls, toasts, resize handles, scrollbars, and skeletons.
- Replaced soft/pill geometry with pixel-sharp borders, short hard shadows, block selection states, and token-backed semantic colors without changing outer boxes or hit areas.
- Added reusable Android pixel-border, hard-shadow, and dither modifiers.
- Restyled Android shared buttons, dialogs, search, popovers, badges, loading placeholders, and step indicators while retaining Material sizing and navigation behavior.
- Verified theme generation, desktop type checking, focused renderer behavior tests, and Android debug Kotlin compilation.

Next slice: add the licensed short-chrome bitmap typography foundation, then begin the semantic pixel-icon system with shared application chrome.

### Slice 3 — bitmap typography and semantic chrome icons (completed 2026-07-31)

- Bundled the OFL-licensed Silkscreen face as desktop WOFF2 and Android TTF assets, with the complete license notice under `docs/licenses/`.
- Added explicit brand, panel-title, and status-label typography roles while retaining the existing platform body typography for chat, forms, Markdown, and long labels.
- Added pixel-safe image rendering utilities for desktop raster/SVG assets.
- Introduced semantic `NexyIcon` APIs on desktop and Android, backed by original grid-aligned glyphs rather than screen-level Lucide or Material selections.
- Migrated desktop title-bar/sidebar chrome and Android home/top-bar/overflow/FAB chrome to the semantic icon layer without changing icon boxes or touch targets.
- Replaced the migrated desktop spinning activity glyphs with static pixel busy records in line with the no-decorative-motion policy.

Next slice: extend semantic icon adoption through section panes and Android navigation/chat chrome, then restyle the existing desktop and Android chat surfaces.

### Slice 4 — chat foundation and conversation chrome (completed 2026-07-31)

- Extended the semantic icon vocabulary with search, attachment, composer, voice, send/stop, status, and common file/action glyphs on both platforms.
- Migrated the desktop shared pane search and Chats pane, including static generating/unread/completed indicators and block selection treatment.
- Migrated the desktop composer and its consolidated actions menu to semantic pixel icons, inset fields, hard borders, and hard shadows while retaining its exact resize and action layout.
- Restyled desktop user/system/error message frames and message action controls without changing message alignment or maximum width.
- Migrated the Android chat input sheet/actions and top-bar chat actions to the semantic pixel-icon layer.
- Restyled the Android chat input and user-message frames while preserving the existing 36/40 dp action boxes, 80% bubble width, padding, and navigation behavior.
- Verified desktop type checking and focused lint, Android debug Kotlin compilation, and 78 focused renderer tests; eight `ChatWindow` assertions remain blocked by pre-existing expectations for actions that now live in the consolidated menu and an aria-hidden resize handle.

Next slice: migrate the remaining desktop pane families and Android chat timeline/tool/action icons, then finish the chat context/status surfaces.

### Slice 5 — timeline, context, and history surfaces (completed 2026-07-31)

- Migrated desktop agent/project conversation history status and row actions to semantic pixel icons, including pinned, code-change, generating, completed, selection, search, add, and delete states.
- Restyled the desktop artifact pane with token-backed toolbar, search, scope controls, pending-generation frame, static busy glyph, and semantic export/delete actions while preserving all row and control dimensions.
- Restyled the desktop `@` context and slash-command menus with the shared raised/recessed surfaces, hard borders, hard shadows, and block selection states.
- Extended Android's semantic icon vocabulary for tool, reasoning, attachment, image, copy, share, playback, error, and disclosure actions.
- Migrated Android chat activity, reasoning, message actions, spoken-output controls, attachment/model-picker chrome, send-failure status, and tool-call status/disclosure rows away from direct Material icons.
- Replaced the migrated circular spinner/dot activity treatment with static square pixel records without changing timeline or touch-target geometry.
- Verified desktop type checking, lint, production build, generated-theme drift, semantic icon tests, artifact-pane tests, Android debug Kotlin compilation, and diff validation.

Next slice: migrate the desktop projects/agents/skills/schedules/workflow pane families and Android conversation/context sheets, then sweep remaining chat timeline glyphs and legacy rounded status surfaces.

### Slice 6 — work-management panes and Android context sheets (completed 2026-07-31)

- Migrated the desktop Projects, Agents, Skills, Scheduled Tasks, and Automated Workflows pane chrome to semantic pixel icons and token-backed rectangular rows, search fields, controls, status records, and popovers.
- Migrated the shared automated-workflow stages, action buttons, run/step statuses, workflow cards, output frames, and busy records so project-scoped and global workflow surfaces remain visually consistent.
- Removed decorative workflow spinner/pulse treatments in favor of static pixel busy and cursor records.
- Expanded Android's semantic icon vocabulary for conversation export/import, compression, forks, archives, and related context actions.
- Migrated the Android Conversation Actions and Context Inspector sheets away from direct Material action icons and circular progress indicators.
- Restyled Android context budget, statistics, prompt, and compression cards with square bordered surfaces while retaining existing sheet behavior, row padding, and touch targets.
- Verified desktop type checking, focused lint, production build, generated-theme drift, semantic icon and Projects pane tests, Android debug Kotlin compilation, and diff validation.

### Slice 7 — ratings, workflow generator, and Android history/activity (completed 2026-07-31)

- Migrated the desktop Ratings pane away from direct Lucide icons and legacy neutral utilities, including its rating glyphs, list rows, tags, search/sort controls, section chrome, and chart/tool-tip geometry.
- Connected rating chart ink, axes, grids, and tooltips to the shared generated theme roles while retaining the existing datasets and chart measurements.
- Restyled the automated-workflow generator modal, transcript frame, composer, variable picker, model control, plan-ready record, and actions with the established hard-border and hard-shadow language.
- Replaced the workflow generator's remaining spinner and sparkle library glyphs with semantic static pixel records.
- Migrated Android scoped chat history, shared conversation rows and menus, activity feed, activity edge tab, and status/activity strip to semantic pixel icons.
- Replaced Android history/activity circular progress and dot treatments with static square busy/status records, and replaced hard-coded connectivity/sync colors with Material roles backed by the shared palette.
- Preserved desktop modal/chart bounds, Android 72 dp history rows, FAB/search/touch bounds, navigation, refresh behavior, and all existing actions.
- Verified desktop type checking, Android debug Kotlin compilation, direct legacy-glyph audits for the migrated files, and diff validation.

Next slice: sweep the desktop project settings and generator families, then migrate Android project and agent configuration/generator screens as bounded form families.

### Slice 8 — project creation and configuration forms (completed 2026-07-31)

- Restyled the desktop project-settings shell, tab records, draft actions, and project-generator modal with token-backed raised/recessed surfaces, hard borders, and hard shadows.
- Migrated the desktop project generator away from direct Lucide glyph selection, including project identity, create/edit, prompt, clipboard, close, send, leader, and progress actions.
- Replaced project-generation spinners and rounded progress dots with static semantic busy records and square state marks while retaining the existing modal bounds and two-column proportions.
- Migrated Android project and agent configuration loading, warning, add/remove, and reorder actions to the shared Canvas pixel-icon vocabulary.
- Flattened Android configuration bottom action surfaces and removed their soft elevation while preserving navigation-bar insets, form structure, validation, save behavior, and 48 dp icon-button targets.
- Expanded Android semantic icons with agent, warning, and upward-disclosure glyphs needed by the configuration family.
- Verified desktop type checking, focused lint, production build, generated-theme drift, 29 project-settings behavior tests, Android debug Kotlin compilation, direct legacy-glyph audits, and diff validation.

Next slice: migrate the desktop agent, skill, artifact, and schedule generator families, then apply the matching semantic treatment to Android generator chat screens.

### Slice 9 — agent, skill, artifact, and schedule generators (completed 2026-07-31)

- Migrated the desktop agent, skill, artifact, and schedule generators from direct Lucide selection to the shared semantic pixel-icon API.
- Restyled their existing modal frames, transcript bubbles, assistant records, composer frames, and nested form controls with token-backed raised/recessed surfaces, hard borders, and hard shadows while preserving the established 860 × 640 responsive bounds and column proportions.
- Replaced generator spinners with static semantic busy records and retained all generation, review, edit, retry, model-selection, and create/save flows.
- Migrated Android generator model, search, clear, and schedule glyphs from direct Material selection to the shared Canvas icon vocabulary.
- Added a reusable static four-dp dithered progress record and adopted it across Android agent, skill, artifact, and schedule generation without changing the former progress-bar footprint.
- Added hard pixel borders to shared Android generator chat bubbles and the artifact generator's matching transcript surface.
- Verified focused desktop lint, 10 artifact-generator behavior tests, generated-theme drift, Android debug Kotlin compilation, direct legacy-glyph/loading audits, and diff validation. The repository-wide desktop typecheck remains blocked by an unrelated in-progress JSX error in `chat/SpokenOutputControls.tsx`.

Next slice: sweep quiz, teachback, debrief, and wiki feature families on desktop and Android, then migrate their remaining direct icons and legacy status/card treatments.

### Slice 10 — quiz, teachback, debrief, and wiki (completed 2026-07-31)

- Migrated the desktop quiz, teachback, and debrief artifact cards from direct Lucide selection to the shared semantic pixel-icon API, including loading, retry, playback, recording, grading, regeneration, export, and status actions.
- Restyled their existing cards, option records, progress tracks, selectors, feedback states, story controls, and metadata tags with hard borders, square geometry, static busy records, and shared Nexy surface roles while preserving all flow state and measurements.
- Migrated desktop wiki extraction, save, and project-settings surfaces to semantic icons, square entry/tag/status records, and token-backed recessed/raised surfaces.
- Migrated Android quiz, teachback, debrief, and wiki feature actions away from direct Material icons and circular activity indicators, and removed feature-owned pill geometry and hard-coded quiz state colors.
- Added Android semantic edit, refresh, and spark glyphs and an optional semantic leading-icon path to the shared secondary button without changing its existing API callers.
- Migrated the shared Android chat learning-artifact card to semantic feature, busy, and disclosure glyphs with the same card bounds and behavior.
- Verified desktop type checking, focused lint, production build, generated-theme drift, Android debug Kotlin compilation, and nine of ten focused renderer assertions. One pre-existing quiz test still expects `Regenerate` to start generation immediately even though the current UI opens the quiz-spec dialog first.

Next slice: migrate provider, model, MCP, CLI, connection, and general-settings feature families, then sweep their remaining legacy icons, colors, and status surfaces.

### Slice 11 — providers, models, MCP, CLI, connection, and general settings (completed 2026-07-31)

- Migrated the desktop Settings navigation rail and General-tab action glyphs from direct Lucide selection to the shared semantic pixel-icon API without changing the modal or rail dimensions.
- Restyled desktop provider credential cards, configured/default/test states, handoff notice, inputs, actions, and CLI installation records with hard borders, square status records, token-backed semantic colors, and static busy glyphs.
- Added a settings-scoped square-control treatment so nested fields and menus adopt the Command Office geometry while retaining their current footprints and behavior.
- Migrated Android provider loading/actions, CLI model refresh, MCP server add/edit/restart/delete/check actions, shared model/update/connection status actions, and disclosure controls to the semantic Canvas icon vocabulary.
- Replaced Android provider circular loading and indeterminate update animation with static pixel busy/progress records; determinate download progress remains determinate.
- Replaced remaining feature-owned settings error/warning hex values with shared Material semantic roles and squared the existing MCP/update configuration cards without changing rows, sheets, forms, or touch targets.
- Verified desktop type checking, focused lint, production build, generated-theme drift, 32 focused renderer tests, Android debug Kotlin compilation, targeted legacy-glyph/loading audits, and diff validation.

Next slice: migrate file explorer, code panel, diff viewer, build dashboard, logs, and diagnostics surfaces, including the deferred desktop developer-settings family.

### Slice 12 — developer tools, files, diffs, builds, logs, and diagnostics (completed 2026-07-31)

- Migrated desktop build output, Android debug-log overlay, code-change plan previews, and tool-approval records to semantic pixel icons, token-backed terminal surfaces, hard borders/shadows, square progress tracks, and static busy records.
- Migrated the desktop Developer Settings icon vocabulary from direct Lucide selection to semantic glyph adapters and added a feature-scoped terminal treatment for its existing build, signing, OTA, console, and status surfaces without changing their state logic or layout.
- Added Android file, folder, and home glyphs, then migrated file explorer breadcrumbs, locations, entries, file trees, diff disclosures, and loading states to the shared Canvas icon vocabulary.
- Migrated the Android code-panel action specification from Material `ImageVector` values to semantic icon names, including repository, branch, fetch/pull/push, stage/commit/merge/stash, changed-file, and diff-loading actions.
- Extended the shared Android primary-button primitive with optional semantic leading icons while retaining its existing `ImageVector` compatibility path.
- Migrated Android build-dashboard refresh/search/loading records and debug-log actions, squared feature-owned build/log frames, and replaced hard-coded diff/add/remove/warning colors with generated semantic roles.
- Verified desktop type checking, focused lint, production build, generated-theme drift, 19 focused settings/approval tests, Android debug Kotlin compilation, targeted legacy-icon/loading/color audits, and diff validation.

Next slice: migrate onboarding, pairing, splash, empty, offline, error, and recovery-state families, then begin the static brand-asset pass.

### Slice 13 — onboarding, pairing, splash, empty, offline, error, and recovery states (completed 2026-07-31)

- Migrated desktop onboarding from direct Lucide icons and soft setup cards to semantic pixel glyphs, static CLI detection records, hard terminal frames, and generated semantic roles.
- Restyled the desktop renderer error boundary as a token-backed recovery terminal with a semantic error record and retry action while preserving reset-key behavior and diagnostic disclosure bounds.
- Migrated the desktop Mobile pairing tab to semantic pixel actions and a scoped hard-geometry treatment without changing server, QR, profile, FCM, or wake-on-LAN behavior.
- Migrated Android pairing start, QR/manual pairing, saved-server, and connection activity states away from direct Material glyphs and circular activity indicators.
- Replaced the Android splash wordmark treatment with a theme-aware square pixel brand record while retaining the existing 800 ms handoff.
- Kept the shared desktop composer/offline messaging and Android empty/recovery primitives on their existing semantic theme roles; backup/restore and reconnect behavior remain unchanged.
- Verified desktop type checking, focused onboarding/error-boundary behavior tests, focused lint, generated-theme drift, Android debug Kotlin compilation, and diff validation.

Next slice: generate and validate the desktop and Android static brand/launcher assets from the reproducible icon source, then begin full parity and accessibility validation.

### Slice 14 — reproducible desktop and Android brand assets (completed 2026-07-31)

- Rebuilt `scripts/generate-icons.py` around a single original 32 × 32 logical-grid Nexy mark sourced from the generated Command Office dark-theme palette.
- Replaced rounded, antialiased geometry with a stepped terminal tile, block stems, and a whole-pixel staircase diagonal; all output scaling now uses nearest-neighbor sampling.
- Added a deterministic `--check` mode that reports missing or stale raster, container, or adaptive-vector launcher outputs without modifying the worktree.
- Regenerated the 1024 px desktop PNG, six-frame Windows ICO, three-entry macOS ICNS, and all square/round Android legacy WebP densities.
- Generated Android adaptive background and foreground vectors from the shared midnight/accent palette and kept the grid-authored glyph inside the 66 dp safe zone.
- Verified source reproducibility, PNG/ICO/ICNS container structure, Android lossless WebP resources, the desktop packaging references, and Android resource compilation.

Next slice: run the full desktop/Android parity, accessibility, contrast, theme, and layout-regression validation matrix, then resolve only restyle-owned findings.

### Slice 15 — automated parity and accessibility readiness (completed 2026-07-31)

- Added `scripts/check-ui-contrast.mjs` and the `check:ui-contrast` package command so required theme, semantic-state, and project-color contrast pairs are checked directly from the shared token source.
- Verified 34 light/dark foreground, muted-text, accent, border, focus, semantic-container, and project-container combinations; all meet their applicable 4.5:1 text or 3:1 non-text threshold.
- Replaced the remaining Android chat-history pulse with a static dithered placeholder that retains every row's measured width and 16 dp height.
- Replaced animated connection transitions, rotation, pulsing, and shaking with static semantic Canvas glyphs and generated theme roles while preserving the existing 48 dp status target, progress label, and screen-reader description.
- Corrected a checked-in Kotlin unit-test name whose unescaped spaces prevented the Android unit suite from compiling.
- Verified desktop type checking, lint with no errors, production build, generated-theme drift, launcher reproducibility, no-visual-motion policy, 56 geometry-oriented renderer assertions, Android debug Kotlin compilation, and Android debug assembly.
- Full Android unit execution now reaches 289 tests: 262 pass and 27 existing `ChatViewModelTest` cases fail because local JVM tests call the unmocked `android.os.SystemClock.elapsedRealtime` API.
- Android lint is clean for this slice but remains blocked by six existing repository findings: the AGP update detector, `FileTreeView` modifier ordering, a debrief `StateFlow.value` composition read, and three obsolete SDK checks in `NexySpeechService`.
- `connectedDebugAndroidTest` is skipped because the attached device is visible to ADB only as `unauthorized`; USB-debugging authorization is required before instrumentation can run.

Next slice: finish the source-wide residual direct-icon and legacy-motion audit, then perform the light/dark screenshot, keyboard, TalkBack, zoom, font-scale, and product-sign-off matrix. The roadmap remains in progress until those manual gates and the documented baseline test/lint blockers are resolved.

### Slice 16 — selectable visual style (completed 2026-07-31)

- Reframed Command Office as a persisted `8-bit` UI style alongside the existing `Classic` style on desktop and Android.
- Kept appearance brightness independent: desktop Light/Dark and Android System/Light/Dark continue to work unchanged, yielding every Classic/8-bit brightness combination.
- Added UI-style controls to desktop General settings and Android Appearance settings, with Classic as the fallback for installations without a saved style preference.
- Added a desktop root style attribute and compatibility token layer for classic palette, radii, borders, shadows, typography, scrollbars, skeletons, and migrated terminal utility classes.
- Made the shared desktop semantic icon component render Lucide icons in Classic and pixel-grid glyphs in 8-bit mode.
- Added an Android UI-style composition local that selects the original Material color schemes and shapes or the generated Command Office schemes and compact shapes.
- Made shared Android semantic icons, pixel modifiers, progress records, explicit migrated surface shapes, brand typography, and shared buttons style-aware without changing their measured bounds or callbacks.
- Persisted the preference locally on each platform; no desktop/Android pairing protocol or account setting was added.

Next slice: complete the remaining manual and baseline validation gates across all four visual combinations per platform.

### Slice 17 — Classic motion parity (completed 2026-07-31)

- Restored Classic desktop busy rotation centrally through the semantic icon boundary, including explicit pulse behavior for build activity and code-change activity records.
- Kept all desktop spinner, bounce, and pulse animation exceptions scoped to `data-ui-style='classic'`; 8-bit semantic glyphs and activity records remain static.
- Restored Classic Android busy-icon rotation centrally so migrated loading call sites retain Material motion without screen-level duplication.
- Restored the original Classic Android chat-history pulse while preserving the 8-bit theme's static dithered rows and measured skeleton geometry.
- Restored the Android connection status fade/scale transition, synchronization rotation, error pulse/shake, and entry motion only in Classic; 8-bit and disabled-system-animation paths remain static.
- Added focused desktop icon motion tests and changed the source policy gate from an unconditional Android motion ban to a strict allowlist of shared, UI-style-gated motion boundaries.
- Verified desktop type checking, focused theme-motion tests, theme-aware source-policy tests, focused lint with no errors, and whitespace validation. Android Kotlin compilation remains environment-blocked because the configured Foojay and Android Gradle plugin markers are unavailable in the offline cache and network access is disabled; no build configuration was changed.

Next slice: complete the remaining manual and baseline validation gates across all four visual combinations per platform.

### Slice 18 — Retro loading cues (completed 2026-07-31)

- Added a slow stepped opacity pulse to desktop 8-bit busy glyphs, loading skeletons, and active-work records while retaining Classic motion and explicit per-call busy-motion suppression.
- Added a slow opacity pulse to Android 8-bit busy glyphs and the dithered chat-history loading skeleton.
- Kept the retro cue scoped to active loading records and disabled it when desktop reduced-motion or Android system animator settings request static content.

## Summary

Restyle the existing Nexy desktop and Android interfaces as a formal 8-bit “Command Office” without changing their information architecture, layouts, navigation, sizing, or behavior.

The implementation principle is:

> Same interface, new 8-bit visual system.

This is a visual-system migration. It is not permission to rearrange screens, introduce new navigation, resize panels, change destination order, simplify workflows, or replace platform-native interaction patterns.

## Scope

### In scope

- Shared light/dark color tokens
- Shared project and semantic status palettes
- Pixel-style icon system
- Typography roles and bundled font assets
- Borders, corners, focus states, dividers, shadows, selection, and scrollbars
- Existing buttons, fields, tabs, cards, menus, dialogs, sheets, notifications, badges, progress, loading, and empty states
- Desktop application icons and Android launcher icons
- Desktop and Android visual parity audits
- Accessibility, contrast, theme, and layout-regression validation

### Explicitly out of scope

- Moving, adding, removing, or reordering navigation destinations
- Changing the desktop panel arrangement or resizable-panel limits
- Changing Android routes, back behavior, bottom navigation, or sheet/dialog flows
- Changing component placement, touch-target dimensions, or information density
- Rewriting feature behavior, state, persistence, IPC, WebSocket, or data contracts
- Adding decorative motion, simulated low frame rates, CRT distortion, boot delays, or continuous blinking
- Editing third-party dependencies, `node_modules`, build output, release binaries, or personal configuration

## Current implementation findings

The migration can start from existing shared foundations, but both platforms still need a deliberate adoption pass.

### Desktop

- Global behavior and limited global styling live in `src/renderer/styles/global.css`.
- Reusable controls live primarily in:
  - `src/renderer/components/ui/primitives.tsx`
  - `src/renderer/components/ui/ConfirmDialog.tsx`
  - `src/renderer/components/section-pane/pane-primitives.tsx`
- Styling is predominantly direct Tailwind utility usage. The renderer contains several thousand neutral color references, so changing isolated components will leave a visibly mixed design.
- Lucide icons are imported by roughly 85 renderer files.
- Project colors are centralized partially in `src/renderer/components/section-pane/shared.tsx`, but a second project badge map exists in `TitleBar.tsx`.
- The existing unconditional no-motion policy in `global.css` already aligns with the restrained retro direction.

### Android

- The theme foundation is centralized in:
  - `android/app/src/main/java/io/nexy/android/ui/theme/Color.kt`
  - `android/app/src/main/java/io/nexy/android/ui/theme/Theme.kt`
  - `android/app/src/main/java/io/nexy/android/ui/theme/Type.kt`
  - `android/app/src/main/java/io/nexy/android/ui/theme/Spacing.kt`
- Shared controls live primarily in:
  - `android/app/src/main/java/io/nexy/android/ui/components/NexyUx.kt`
  - `android/app/src/main/java/io/nexy/android/ui/components/NexyButton.kt`
- Material icons are imported by roughly 51 Android UI files.
- Hard-coded colors remain in about twenty Android UI files in addition to the theme.
- Android currently supports system/light/dark preferences; the restyle must retain that behavior.
- The Android project-color helper exposes colors that do not exactly match the desktop set.

## Visual contract

All implementation work must follow these constraints.

### Geometry

- Keep every existing component box, panel boundary, route, and interaction area in place.
- Desktop: use square or 0–4 px corners and 1–2 px pixel-sharp borders.
- Android: use 0–8 dp corners while retaining all existing minimum touch targets.
- Borders render inward where possible so they do not alter measured dimensions.
- Shadows are hard, short offsets; no diffuse elevation glow.
- Dither/checker treatments are decorative backgrounds only and cannot affect measurement.

### Typography

- Keep the current readable body typeface and metrics for chat, forms, descriptions, Markdown, and documentation.
- Add one licensed bitmap display font only for short chrome: branding, compact headings, status labels, badges, and brief button labels.
- Do not apply all-caps pixel text to paragraphs.
- Font substitution must not cause new wrapping, clipping, component-height changes, or reduced Android accessibility scaling.

### Color

- Use warm “terminal paper” neutrals in light mode and ink/navy “midnight computer” neutrals in dark mode.
- Preserve saturated project identity colors.
- Keep project colors separate from semantic states.
- Every semantic state uses color plus text/icon/shape:
  - red: failure/destructive
  - amber: warning/approval
  - green: success/completed
  - blue/cyan: connection/sync
  - violet: AI generation/agent activity
  - gray: offline/paused/archived
- Normal chat-reading surfaces stay neutral.

### Icons

- Use semantic icon names in application code; platform-specific rendering belongs behind the icon layer.
- Desktop pixel icons use a 16×16 source grid and scale only by integer multiples where practical.
- Android variants use the same silhouettes in 20/24 dp viewports with touch targets unchanged.
- Icons remain one or two colors unless they represent project identity or semantic status.
- Every icon-only action retains an accessible name/content description.

### Motion and loading

- Preserve smooth native scrolling and input.
- Keep the current no-decorative-motion policy.
- Replace soft shimmer, pulse, and bounce treatments with discrete segmented progress, a block cursor, or a limited two-frame busy indicator where appropriate.
- Respect reduced-motion settings and never flash rapidly.

## Target shared palette

Final values should be captured in the shared token source during Phase 1. These values are the proposed baseline and may be adjusted only after contrast checks.

### Light: Paper Terminal

| Role | Proposed value |
|---|---:|
| Outer frame/background | `#252A36` |
| Main surface | `#F2EED8` |
| Raised surface | `#FFFBE8` |
| Recessed surface | `#D8D4BE` |
| Primary ink | `#171922` |
| Muted ink | `#5C5D59` |
| Highlight edge | `#FFFFFF` |
| Shadow edge | `#65675F` |
| Nexy accent | `#5146C8` |

### Dark: Midnight Computer

| Role | Proposed value |
|---|---:|
| Outer frame/background | `#090D18` |
| Main surface | `#121A2B` |
| Raised surface | `#1C2740` |
| Recessed surface | `#080C15` |
| Primary text | `#F0EBCF` |
| Muted text | `#9EA7A2` |
| Highlight edge | `#53627D` |
| Shadow edge | `#02040A` |
| Nexy accent | `#8D7CFF` |

### Project palette contract

Use the same names and values on both platforms:

| Name | Main | Dark | Light |
|---|---:|---:|---:|
| Blue | `#3478D4` | `#1A376E` | `#C9DDFC` |
| Green | `#3A9D58` | `#1B512E` | `#CDECCF` |
| Red | `#D34A4A` | `#702626` | `#F2CCCC` |
| Purple | `#8257C7` | `#432B6D` | `#DFD0F4` |
| Orange | `#D37832` | `#70401D` | `#F1D3B9` |
| Pink | `#C45185` | `#702A4A` | `#F1CCE0` |
| Yellow | `#C59A22` | `#66500F` | `#F4E5A9` |
| Cyan | `#278E9D` | `#164C54` | `#C5E8E9` |
| Gray | `#667078` | `#394047` | `#E1E5E7` |

Existing stored names must continue to render. Legacy `teal` and `indigo` values on Android should map to `cyan` and `purple`-family presentation rather than invalidating stored projects.

## Implementation phases

### Phase 0 — Freeze the layout baseline

**Goal:** make “no structural change” verifiable before visual code changes begin.

Work:

- Capture reference screenshots for the existing desktop and Android screens listed in the visual matrix below.
- Record key layout measurements:
  - desktop title bar, sidebar, section pane, chat area, composer, optional agent panel, modal bounds
  - Android top bar, bottom navigation, chat timeline, composer, dialog/sheet, list rows, and touch targets
- Add lightweight layout assertions to existing renderer and Compose UI tests where stable semantics already exist.
- Record current keyboard navigation, desktop resize behavior, Android back behavior, and theme preference behavior.
- Do not “correct” layout issues during this phase; log unrelated issues separately.

Primary files:

- `src/renderer/App.tsx`
- `src/renderer/components/TitleBar.tsx`
- `src/renderer/components/Sidebar.tsx`
- `src/renderer/components/SectionPane.tsx`
- `src/renderer/components/ChatWindow.tsx`
- `android/app/src/main/java/io/nexy/android/navigation/NavGraph.kt`
- `android/app/src/main/java/io/nexy/android/ui/home/HomeScreen.kt`
- `android/app/src/main/java/io/nexy/android/ui/chat/ChatScreen.kt`

Exit criteria:

- Baseline images and measurements are checked into a small `docs/ui/8bit-baseline/` reference set or documented with reproducible capture commands.
- Critical panel, navigation, composer, and touch-target invariants have automated assertions where feasible.

### Phase 1 — Establish one cross-platform token source

**Goal:** prevent desktop and Android palettes from drifting.

Work:

- Add a source-of-truth file such as `design/nexy-8bit-theme.json`.
- Add `scripts/generate-ui-theme.mjs` to generate:
  - `src/renderer/styles/generated-theme.css`
  - `android/app/src/main/java/io/nexy/android/ui/theme/GeneratedNexyColors.kt`
- Include neutral ramps, semantic colors, project colors, border roles, shadow roles, corner roles, and typography role names.
- Check generated files into source control.
- Add a check mode that fails when generated files differ from the JSON source.
- Map Tailwind theme colors to CSS variables in `tailwind.config.js`; preserve opacity modifiers by using RGB channel variables.
- Import the generated CSS from `global.css`.
- Refactor Android `Color.kt` and `Theme.kt` to consume generated values while preserving `MaterialTheme` light/dark behavior.
- Consolidate desktop project-color lookups into one helper and Android project-color lookups into the generated project palette.
- Preserve fallback rendering for unknown/legacy stored project colors.

Primary files:

- `design/nexy-8bit-theme.json` (new)
- `scripts/generate-ui-theme.mjs` (new)
- `src/renderer/styles/generated-theme.css` (generated)
- `src/renderer/styles/global.css`
- `tailwind.config.js`
- `src/renderer/components/section-pane/shared.tsx`
- `src/renderer/components/TitleBar.tsx`
- `android/app/src/main/java/io/nexy/android/ui/theme/GeneratedNexyColors.kt` (generated)
- `android/app/src/main/java/io/nexy/android/ui/theme/Color.kt`
- `android/app/src/main/java/io/nexy/android/ui/theme/Theme.kt`
- `android/app/src/main/java/io/nexy/android/ui/home/HomeScreenHelpers.kt`
- `package.json`

Exit criteria:

- One edit to the token JSON reproducibly updates both platforms.
- Light/dark and every project/semantic color have a named role.
- Existing theme preferences and stored project colors still work.
- Contrast checks meet WCAG AA for normal text and visible focus indicators.

### Phase 2 — Add typography and pixel-safe rendering foundations

**Goal:** introduce retro character without harming reading or measurement.

Work:

- Select an SIL Open Font License-compatible bitmap face and record its license.
- Bundle WOFF2 for desktop and Android font resources from the same source.
- Define display/chrome and mono metadata roles; keep body/reading roles on the current legible platform font.
- Add CSS utilities/Compose text styles for:
  - brand display
  - short panel title
  - status label
  - compact metadata/code
- Add pixel-rendering helpers for SVG/image assets where supported.
- Verify font fallback, non-English glyphs, 125% desktop zoom, and Android font scaling.

Primary files:

- `src/renderer/assets/fonts/` (new)
- `src/renderer/styles/global.css`
- `android/app/src/main/res/font/` (new)
- `android/app/src/main/java/io/nexy/android/ui/theme/Type.kt`
- `docs/licenses/` or the repository’s chosen third-party notice location

Exit criteria:

- Long-form chat and form copy remain as readable and no denser than before.
- No baseline screen gains clipping or material reflow.
- Android text remains usable at 1.0×, 1.3×, and 1.5× font scale.

### Phase 3 — Restyle shared primitives first

**Goal:** make the majority of screens adopt the visual language through existing abstractions.

Desktop work:

- Restyle `ModalShell`, `Button`, fields, toggles, cards, tabs, save states, confirmation dialogs, pane primitives, search, toasts, and resize handles.
- Replace rounded pills with rectangular/block states while keeping their outer boxes and hit areas.
- Add visible keyboard focus and disabled/pressed/selected states.
- Restyle scrollbars as square tracks/thumbs without changing their allocated width.
- Replace skeleton shimmer with segmented/dithered loading treatment.

Android work:

- Update Material shapes to the 8-bit geometry without changing component measurements.
- Restyle `NexyButton` variants and all primitives in `NexyUx.kt`.
- Define reusable pixel border, hard-shadow, dither, section-header, selected-row, and segmented-progress modifiers/composables.
- Keep 48 dp minimum touch targets and existing sheet/dialog behavior.

Primary files:

- `src/renderer/components/ui/primitives.tsx`
- `src/renderer/components/ui/ConfirmDialog.tsx`
- `src/renderer/components/section-pane/pane-primitives.tsx`
- `src/renderer/components/SearchBar.tsx`
- `src/renderer/components/Toast.tsx`
- `src/renderer/components/ResizeHandle.tsx`
- `src/renderer/styles/global.css`
- `android/app/src/main/java/io/nexy/android/ui/theme/Theme.kt`
- `android/app/src/main/java/io/nexy/android/ui/components/NexyButton.kt`
- `android/app/src/main/java/io/nexy/android/ui/components/NexyUx.kt`
- `android/app/src/main/java/io/nexy/android/ui/components/NexyPixelSurface.kt` (new)

Exit criteria:

- Every primitive has light/dark, hover/pressed where applicable, focused, selected, disabled, loading, validation, and destructive states.
- Existing primitive tests remain green and gain state/semantics coverage.
- No primitive changes its public API unless required to remove a hard-coded visual value.

### Phase 4 — Build and adopt a semantic pixel-icon system

**Goal:** replace Lucide/Material visual inconsistency without coupling screens to asset implementations.

Work:

- Inventory icons by semantic purpose, not by current library glyph name.
- Define an initial complete semantic set covering navigation, window actions, chat/composer, projects, agents, artifacts, automation, wiki, settings, files, connection, notifications, approvals, success/error/warning, expand/collapse, edit/delete, and media/voice.
- Create original SVG sources on a strict pixel grid.
- Add:
  - desktop React wrappers/components under `src/renderer/components/ui/icons/`
  - Android vector/Compose equivalents under `android/.../ui/icons/`
- Expose semantic names such as `NexyIcon.Chat`, `NexyIcon.Approval`, and `NexyIcon.Connection`; do not expose Lucide or Material names through the new API.
- Migrate shared chrome first, then feature screens.
- Retain accessible labels and verify icons at every used size.
- Remove direct Lucide/Material icon imports from first-party UI when migration is complete. The library dependencies may remain until a separate dependency-cleanup decision.

Primary files:

- `src/renderer/components/ui/icons/` (new)
- `android/app/src/main/java/io/nexy/android/ui/icons/` (new)
- Approximately 85 current desktop icon-importing files
- Approximately 51 current Android icon-importing files

Exit criteria:

- No first-party screen directly selects a Lucide or Material symbol.
- The same semantic action has a recognizably matching silhouette on both platforms.
- Icons fit current boxes; no navigation, row, or button measurement changes.

### Phase 5 — Restyle application chrome and the chat workflow

**Goal:** complete the most visible surfaces early while preserving their exact structure.

Desktop order:

1. `TitleBar`
2. `Sidebar`
3. `SectionPane` and pane implementations
4. `ChatWindow`
5. `chat/ChatComposer`
6. `MessageBubble` / `chat/ChatMessages`
7. tool calls, thinking, code blocks, attachments, and model/mode menus
8. approvals, activity, connection, and toast/status treatments

Android order:

1. `HomeScreen` and existing home components/tabs
2. existing navigation chrome
3. `ChatScreen`, timeline, bubbles, and input
4. model/mode/action sheets
5. tool calls, reasoning, code blocks, attachments, and context inspector
6. connection/activity/approval status surfaces

Rules:

- User messages may receive a framed block treatment; assistant messages remain document-like and neutral.
- Project color appears in existing identity locations only; do not add new rails/panels that change layout.
- Code blocks keep identical cross-platform syntax colors unless the palette is deliberately updated on both platforms in the same change.
- Replace animated generating treatments with a block/segmented indicator, not a typewriter delay.

Exit criteria:

- A complete chat can be created, streamed, stopped, resumed, approved, and revisited on both platforms with no behavior regressions.
- Layout-baseline measurements remain within the agreed tolerance.
- Light/dark screenshots read as the same design family.

### Phase 6 — Screen-by-screen adoption sweep

**Goal:** eliminate the mixed old/new appearance across the whole application.

Work by feature family:

1. Projects and project settings
2. Agents, skills, and generators
3. Artifacts, quiz, teachback, debrief, and wiki
4. Scheduled tasks and automated workflows
5. Providers, models, MCP, CLI, connection, and general settings
6. File explorer, code panel, diff viewer, build dashboard, logs, and diagnostics
7. Onboarding, pairing, splash, empty, offline, error, and recovery states

For each family:

- Replace hard-coded neutral and semantic colors with token roles.
- Replace direct icons with semantic pixel icons.
- Replace ad hoc controls with existing shared primitives where doing so does not alter layout/behavior.
- Verify default, empty, loading, error, disabled, populated, and destructive states.
- Verify both themes before moving to the next family.

Exit criteria:

- No unexplained first-party hex colors remain outside token/generated files, syntax themes, charts, image rendering, or protocol-derived project data.
- No visibly modern rounded-card/pill styling remains unless a platform behavior requires the shape.
- All screens preserve their existing routes, hierarchy, placement, and function.

### Phase 7 — Brand and static assets

**Goal:** make application-level assets match the in-app system.

Work:

- Update `scripts/generate-icons.py` to render a crisp 8-bit Nexy mark without anti-aliased geometry at small sizes.
- Regenerate:
  - `resources/icon.png`
  - `resources/icon.ico`
  - `resources/icon.icns`
  - Android launcher resources
- Update Android adaptive foreground/background vectors.
- Restyle empty-state or decorative art only where it already exists; do not add large new illustrations that change layout.
- Verify Windows/macOS/Linux icon sizes and Android adaptive-icon safe zones.

Primary files:

- `scripts/generate-icons.py`
- `resources/`
- `android/app/src/main/res/drawable/`
- `android/app/src/main/res/mipmap-*/`

Exit criteria:

- Icons are legible from 16 px through store/launcher sizes.
- Generated outputs are reproducible from the script.
- No release or compiled artifacts are committed as part of the source restyle.

### Phase 8 — Full validation and release readiness

**Goal:** prove visual parity, accessibility, and behavioral stability.

Automated desktop gates:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run check:ui-theme
```

Automated Android gates:

```powershell
Set-Location android
.\gradlew.bat testDebugUnitTest
.\gradlew.bat lintDebug
.\gradlew.bat assembleDebug
.\gradlew.bat connectedDebugAndroidTest
```

`connectedDebugAndroidTest` is required when an emulator/device is available; record it as skipped with reason otherwise.

Manual/visual gates:

- Compare against Phase 0 geometry baselines.
- Keyboard-only desktop traversal, including focus visibility and dialogs.
- Screen-reader semantics for icon-only controls and status.
- Android TalkBack spot check and system back-navigation check.
- Desktop zoom: 80%, 100%, 125%.
- Android font scale: 1.0×, 1.3×, 1.5×.
- High-contrast/contrast audit for text, disabled controls, status, and focus.
- Long names, long translated-looking labels, empty data, dense data, offline, error, loading, approval, and destructive states.
- Smooth chat scrolling and stable input/composer height.

Exit criteria:

- All automated gates pass, except explicitly documented environment-only skips.
- No critical layout measurement changes.
- No clipped actions, unreadable state, inaccessible icon, or theme flash.
- Product sign-off is captured for both light and dark visual matrices.

## Visual review matrix

### Desktop

Capture light and dark at 1280×720, 1440×900, and 1920×1080:

- Empty/new chat
- Populated conversation with Markdown, code, attachment, reasoning, and tool activity
- Active generation and stop state
- Tool approval and destructive confirmation
- Projects pane and project settings
- Agent panel and generator
- Artifact view
- Settings/provider/model screen
- Activity/toast/error/offline states

### Android

Capture light and dark at representative 360×800 and 412×915 viewports:

- Home with projects and activity
- Empty/new chat
- Populated conversation with Markdown, code, attachment, reasoning, and tool activity
- Active generation and stop state
- Approval dialog/notification path
- Project configuration
- Agent/artifact/generator screens
- Settings, connection, and diagnostics
- Bottom sheet, full-screen form, empty, error, and offline states

## Layout-preservation acceptance rules

Unless fixing an independently approved bug:

- Desktop pane widths, min/max resize constraints, title-bar height, composer bounds, modal bounds, and hit targets do not change.
- Android navigation bars, top bars, list-row bounds, sheets/dialog behavior, and 48 dp touch targets do not shrink.
- No destination, tab, button, field, status, or action is added, removed, renamed, reordered, or relocated as part of the restyle.
- Text wrapping may not create inaccessible or clipped actions.
- Any intentional measurement change requires separate approval and must not be hidden inside visual-restyle work.

## Delivery strategy

Deliver as small reviewable changes rather than one long-lived branch:

1. Baseline and token generator
2. Typography and shared primitives
3. Semantic icon source and shared chrome adoption
4. Desktop chat/chrome
5. Android home/chat/chrome
6. Feature-family sweeps
7. Brand assets
8. Final parity/accessibility cleanup

Each change should:

- touch one coherent layer or feature family;
- include before/after light and dark captures;
- pass the relevant platform tests;
- document any remaining legacy styling;
- avoid unrelated behavior refactors.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Tailwind utility migration leaves mixed styling | Map legacy palettes through tokens first, then audit direct utilities by feature family |
| Pixel font changes wrapping | Restrict it to short chrome and retain existing body metrics |
| Borders alter component measurements | Use inset borders/box-sizing and compare Phase 0 geometry |
| Icon replacement changes alignment | Preserve viewport and wrapper dimensions; validate at every existing icon size |
| Desktop and Android palettes drift | Generate both from one checked-in token source and add a stale-output check |
| Project colors conflict with status colors | Keep project identity and semantic roles separate; pair state color with icon/text |
| Android retro styling harms touch usability | Preserve 48 dp targets and use retro geometry inside current hit areas |
| Large migration causes regressions | Merge token/primitives work first, then migrate screen families with per-family gates |
| Existing dirty work overlaps the restyle | Rebase each implementation slice carefully and never overwrite unrelated user changes |

## Definition of done

- Desktop and Android retain their current interface structure and behavior.
- Both platforms consume the same named neutral, semantic, and project-color contract.
- First-party controls and icons consistently use the 8-bit Command Office visual language.
- Light and dark themes are complete on both platforms.
- Project colors remain distinctive and notifications/status remain strongly colored.
- Chat and long-form work remain comfortable and legible.
- Automated build, lint, type, unit, and available instrumentation gates pass.
- The visual review matrix and layout-preservation checks are signed off.
