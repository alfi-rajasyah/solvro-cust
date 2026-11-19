# Keyboard focus and contrast fixes

Status: shipped 2026-11-19
Archive path: `docs/archive/plans/a11y-focus-fixes.md`
Lane: P (wave 1 of the 2026-11-19 issue sweep; one stream, run in parallel with two others on disjoint files)

## Changes

| Issue | Change |
|---|---|
| ISS-082 | InstallBanner dismiss is a sibling button; both banner buttons get an on-primary focus ring; 44 px on touch |
| ISS-092 | useDialogFocus wraps Tab from a focused non-tabbable element; ProjectShare workaround removed |
| ISS-093 | usePanelFocus records the last focus outside the panel; a same-item shell swap keeps the opener |
| ISS-094 | Task statuses primary button: solid focus ring with offset |
| ISS-090 | ConfirmModal warning tone uses the chip-amber pair (4.52:1 light, 7.28:1 dark; hover 5.96:1 / 8.66:1); dialog buttons get DESIGN.md focus styles |

## Close

- `gates.sh --performed-review=opus` on the combined wave: all gates passed.
- Phase review: no blockers; 1 should-fix (usePanelFocus opener wiped on a shell swap) and 3 nits fixed.
- Delivery Gate: PASS. Warning confirm (Mid-week sync redraft) at rest, hover and keyboard focus; Task statuses Save focus ring; install banner with focus ring at 375 px; light and dark, 1280 px and 375 px; Playwright screenshots on the dev stack.
