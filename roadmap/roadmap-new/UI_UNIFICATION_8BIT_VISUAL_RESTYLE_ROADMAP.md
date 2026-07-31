# Roadmap: UI Unification — 8-Bit Visual Restyle

Drafted 2026-07-31. **Status: PROPOSED.**

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
