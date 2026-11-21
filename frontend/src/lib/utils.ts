import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// SOLVRO PATCH (reui-data-grid.md pilot fix round) — plain `twMerge` ships a
// hardcoded default `theme.text` scale (xs/sm/base/lg/xl/2xl/...) that has no
// knowledge of this project's seven named `@theme` typography roles
// (`index.css`: h1, h2, body-lg, body-sm, data-mono, label-caps, meta).
// Two concrete bugs followed from that gap, found live while building the
// Tasks.tsx DataGrid pilot:
//   1. `text-label-caps` didn't dedupe against a stock `text-sm`/`text-xs`
//      sibling in the same `cn()` call — both survived, and the actual
//      winner depended on Tailwind's generated stylesheet order, not the
//      call-site's class-list order.
//   2. Worse: twMerge's `font-size` classGroup only matches suffixes shaped
//      like a t-shirt size, so an unmatched `text-{name}` falls through to
//      the NEXT registered validator for the same `text-` prefix —
//      `text-color`, whose default `theme.color` validator is `isAny`
//      (matches literally anything, since twMerge can't know a project's
//      real color palette without help). So `text-label-caps` was silently
//      filed as a COLOR utility, meaning it deduped against (and evicted)
//      genuine text-color classes like `text-muted-foreground` in the same
//      `cn()` call — a two-tone DataGrid header was the observable symptom.
// `extendTailwindMerge`'s `theme.text` extension point is exactly the list
// `font-size`'s validator checks against (`from-theme.ts` + the `font-size`
// classGroup in `default-config.ts`) — registering these seven names there
// makes twMerge recognize them as font-size utilities FIRST, so they never
// reach the color fallback, and standard `text-{size}` conflict resolution
// (already proven safe via `text-xs` overriding Button's `text-sm`) now
// applies to them too. No visual/behavioral change for any existing
// `text-h1`/`text-h2`/etc. usage — they were never combined with a
// conflicting `text-{size}`/`text-{color}` class in the same `cn()` call
// before, so this only fixes latent conflicts, it doesn't introduce new
// ones.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["h1", "h2", "body-lg", "body-sm", "data-mono", "label-caps", "meta"],
    },
  },
});

/** shadcn-convention class combiner — vendored ui components import this. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Page toolbar controls: the row above a list, board or table that holds its
 * summary and its actions. Everything in that row shares one box (32px high,
 * the height of the control groups in the Gantt toolbar, small radius, 13px
 * text) so it sits on one line, and so every project tab has the same
 * toolbar height:
 *
 * - `TOOLBAR_BUTTON_PRIMARY`: the page's one main action ("Add task", "Add
 *   risk", "New project"). The only solid element in the row.
 * - `TOOLBAR_BUTTON_OUTLINE`: secondary actions beside it ("Add section").
 * - `TOOLBAR_STAT`: a read-only count in the same row ("1 High"). Same box as
 *   the outline button, no hover, since it is not a control; the colour goes
 *   on the number, never on the fill, so it does not compete with the action.
 *
 * Use the constants; do not hand-copy the classes. They had drifted apart
 * page by page (docs/archive/plans/antislop-port.md).
 */
/** The shared box itself, for a toolbar control with its own states (the Filter toggle). */
export const TOOLBAR_BOX = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-3 font-display text-xs";
export const TOOLBAR_BUTTON_PRIMARY = `${TOOLBAR_BOX} tap-target bg-primary font-bold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-60`;
export const TOOLBAR_BUTTON_OUTLINE = `${TOOLBAR_BOX} tap-target border border-outline-variant bg-surface-container-lowest font-semibold text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-60`;
export const TOOLBAR_STAT = `${TOOLBAR_BOX} border border-outline-variant bg-surface-container-lowest font-semibold text-on-surface-variant`;
/**
 * Keyboard focus for a bordered toggle that shows `border-primary` while on. The
 * usual bordered treatment turns the border primary, which an on toggle already
 * is, leaving only the 30% ring (about 1.5:1). An on toggle gets the solid ring
 * with an offset gap instead (about 5:1 against the page), so focus differs from
 * the active border. `offsetClass` names the surface the toggle sits on. An off toggle gets the usual bordered treatment.
 */
export function toggleFocus(on: boolean, offsetClass = "focus-visible:ring-offset-background"): string {
  return on
    ? `focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${offsetClass}`
    : "focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30";
}
