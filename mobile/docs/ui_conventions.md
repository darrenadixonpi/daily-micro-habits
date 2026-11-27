# UI conventions

Screens in `mobile/app/` are assembled only from the shared components in `mobile/src/ui/`.
Layout, safe areas, keyboard handling and touch behaviour are therefore defined once.
`npm run check:ui` (`tools/check_ui_conventions.ts`) enforces rules R1–R7 in CI.
The simulator screenshot workflow (`.github/workflows/ui-screenshots-ios-simulator.yml`) checks what static rules cannot.

| Rule | Requirement | Use instead | Why |
|---|---|---|---|
| R1 | No `ScrollView`, `FlatList`, `SectionList`, `KeyboardAvoidingView` outside `src/ui/screen_layout.tsx` | `ScreenScrollView`, `ScreenMessage` | On iOS 26 the navigation bar is translucent and screens extend beneath it. `ScreenScrollView` does three things. It sets `contentInsetAdjustmentBehavior="automatic"` (defect U1, v0.2.0). It adjusts insets for the keyboard. When the keyboard closes, it returns the content to a valid offset, because React Native scrolls a focused field into view and never scrolls back (found by the simulator tour, v0.2.1). |
| R2 | No `Link asChild`; no `Link` in screens | `NavigationRow`, `PressableCard`, `ActionButton href` | The slot wrapper dropped row styles and stacked label and value vertically (defect U2, v0.2.0). |
| R3 | Every route file is registered in `app/_layout.tsx` or `app/(tabs)/_layout.tsx` with a `title`; every registration has a file | — | Unregistered routes get default headers and titles. |
| R4 | No `TextInput` outside `src/ui/controls.tsx` | `FormField` | Consistent label, error line, placeholder colour and width. |
| R5 | No `ui.row` / `flexDirection: 'row'` in screens | `LabelValueRow`, `TableRow`, `ChipGroup`, `Stepper`, `SwitchRow`, `ButtonRow`, `TrendBars` | These shrink and wrap the label so long text cannot push other content off screen. |
| R6 | No `Pressable`, `Touchable*`, `Button` or `Switch` in screens | Controls in `src/ui/controls.tsx` | Touch feedback, hit areas and accessibility roles in one place. |
| R7 | Every screen renders `ScreenScrollView`, `ScreenMessage` or a `src/ui` screen component built on them (`MilestonePlaceholder`, `PassphraseSetupForm`), and never returns `null` | `<ScreenMessage loading />` | A `null` screen shows a blank page under a header. |

## Shared components (v0.3.0)

| Component | File | Used for |
|---|---|---|
| `ChoiceList` | `src/ui/controls.tsx` | Full-width answer options (A3 recall, A3 cards in Review); marks the correct and the wrong pick after answering; `showIds={false}` for file lists (Restore). |
| `ButtonRow` | `src/ui/controls.tsx` | Equal-width button row (A2 grades); `highlight` marks the suggested grade. |
| `ConfirmActionButton` | `src/ui/controls.tsx` | Two-tap actions with a stated consequence (Report error, Restore). |
| `LinkText` | `src/ui/controls.tsx` | Source links opened in Safari. |
| `TrendBars` | `src/ui/charts.tsx` | 30-day trend bars on Stats; days without data show as stubs. |
| `ReportErrorAction`, `GeneratedBadge` | `src/ui/report_error_action.tsx` | Report error on any content item; the Generated / From Wikipedia label. |

## First-launch prompts

Prompts that must appear on first launch are rendered inside the first screen (Today renders `PassphraseSetupForm` in place of its content), never presented. The simulator tour during v0.2.1 found three presentation approaches that failed:
- `router.push` from a screen effect: dropped before the navigator mounts.
- A JS overlay beside the native stack: covered when the stack's view is re-attached.
- A native `Modal` shown at startup: not presented when requested before its presenting view is in the window.

In Maestro flows, dismiss the keyboard by tapping static text (`tapOn` a `testID`), not `hideKeyboard`. On iOS, `hideKeyboard` is a swipe: it scrolls the screen and can tap buttons.

## Test IDs

Every interactive element that a Maestro flow touches has a `testID` of the form `<screen>-<element>`, for example `d1-priority-1` or `today-module-D2`.
Screens set `testID="screen-<name>"` on their `ScreenScrollView`.

## Simulator tour

`tools/run_ui_screenshots.sh` runs two flows per device:
1. `maestro/screen_tour.yaml`: a fresh install through passphrase setup, every learning module (A3, A1, A4 with a miss, the reveal and a pass, A5 with Save as card), D1–D3, Journal, Stats, Settings, Export, Restore (verify an export and an encrypted backup) and Diagnostics (must read 20/20).
2. `maestro/screen_tour_review.yaml`: a second launch with the `dmhUiTourMakeCardsDue` flag (launch argument plus the app's preferences file), which makes the first flow's review cards due, so Review is photographed with real A1, A4 and A5 cards, including an Again card returning in the same session.

## Release order

1. `Test mobile app` workflow: type-check, unit tests, diagnostics under Node, `check:ui`.
2. `UI screenshots (iOS Simulator)` workflow: Maestro flows on an iPhone Air and the smallest current iPhone. The flows tap and type into every field; a covered field fails the run.
3. Visual review of the screenshots on the `ui-screenshots` branch.
4. `Build iOS (unsigned .ipa for sideloading)`.
