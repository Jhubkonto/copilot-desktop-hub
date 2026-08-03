# 8-bit restyle layout baseline

This reference freezes geometry and behavior for the Command Office visual migration. Restyle changes may alter color, border rendering, corner shape, icon artwork, and non-measuring decoration only.

## Desktop invariants

| Area | Baseline |
|---|---|
| Title bar | `h-9` (36 CSS px at 100% zoom) |
| Sidebar | 256 px initial; 160 px minimum; 480 px or 32% viewport maximum |
| Section pane | 320 px initial; limits remain defined by `PANE_MIN` / `PANE_MAX` |
| Main workspace | 380 px minimum width |
| Agent panel | 440 px initial; 280–700 px resize bounds |
| Resize handles | 4 CSS px hit strip (`w-1` / `h-1`) |
| Shared pane headers | `h-9` (36 CSS px) |
| Shared modal defaults | `h-[84vh]`, `max-w-5xl`; feature overrides remain unchanged |

The following behaviors are also frozen:

- Sidebar, section pane, and agent-panel pointer resizing.
- Keyboard focus trapping and focus restoration in shared modals.
- Escape/backdrop dismissal rules, including busy confirmation dialogs.
- Existing composer bounds, scroll ownership, destination order, and application zoom commands.

## Android invariants

- Keep Material 3 `TopAppBar`, `Scaffold`, dialog, bottom-sheet, and system-inset behavior.
- Keep every existing navigation route and system-back callback.
- Shared list rows retain 16 dp horizontal and 12 dp vertical padding.
- Search retains 12 dp horizontal / 6 dp vertical outer padding and its 36 dp clear action.
- Existing buttons retain Material minimum interactive sizing; no modifier in the visual layer may reduce a touch target below 48 dp.
- Chat input keeps `navigationBarsPadding()` and its existing scroll/composer ownership.
- Text continues to use scalable `sp` typography through `MaterialTheme`.

## Reproducible review matrix

Capture before/after images from the same data fixture and theme at these viewports:

- Desktop: 1280×720, 1440×900, and 1920×1080 at 100%; spot-check 80% and 125% zoom.
- Android: 360×800 and 412×915 in light and dark; spot-check font scales 1.0×, 1.3×, and 1.5×.

At minimum, capture empty chat, populated chat, active generation, approval/confirmation, projects, settings, and error/offline states. Overlay each pair at 50% opacity. Panel edges, headers, controls, composer bounds, and modal/sheet bounds must coincide. A visual border may grow inward, but a measured outer box may not move or resize.

## Automated guards

Run the existing behavior and geometry-oriented suites after each shared visual change:

```powershell
npx vitest run src/renderer/__tests__/confirm-dialog.test.tsx src/renderer/__tests__/searchbar.test.tsx src/renderer/__tests__/resizehandle.test.tsx src/renderer/__tests__/sidebar.test.tsx src/renderer/__tests__/sectionpane.test.tsx src/renderer/__tests__/resizable-chat-input.test.tsx
Set-Location android
.\gradlew.bat :app:compileDebugKotlin :app:connectedDebugAndroidTest
```

The Android instrumentation task requires an attached emulator/device; record it as skipped when none is available.
