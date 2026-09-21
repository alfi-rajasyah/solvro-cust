import { useEffect, useState, useSyncExternalStore } from "react";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  dayToDate,
  formatDisplay,
  nextDraftFromSelection,
  normalizePair,
  rangeFromPair,
} from "@/lib/dateField";
import { cn } from "@/lib/utils";

interface DateRangeFieldProps {
  /** Plain calendar day, `"yyyy-MM-dd"` — no time, no timezone. Null = unset. */
  start: string | null;
  end: string | null;
  /** Fires ONLY on Apply, with the committed draft (day strings, or null per side). */
  onApply: (start: string | null, end: string | null) => void;
  /** Fires when the popover is dismissed without applying (Cancel, outside-click, Escape). */
  onCancel?: () => void;
  disabled?: boolean;
  /** "boxed" = bordered inline-editor look (default). "bare" = borderless FieldRow text. */
  variant?: "boxed" | "bare";
  /** Renders a "Clear" action in the popover footer (left side). Still requires Apply. */
  clearable?: boolean;
  /** Opens the popover on mount — for editor contexts where editing already implies intent to pick. */
  defaultOpen?: boolean;
  /** Extra classes on the trigger button. */
  className?: string;
  "aria-label"?: string;
}

const DESKTOP_QUERY = "(min-width: 768px)";

// Module-scope (not per-render closures) so `useSyncExternalStore` sees a
// stable `subscribe`/`getSnapshot` identity across re-renders — an inline
// closure defined inside the hook body gets a fresh identity every render,
// which makes React tear down and re-add the `matchMedia` change listener
// on every re-render instead of once per mount.
function subscribeToDesktopViewport(onStoreChange: () => void): () => void {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

function getIsDesktopViewport(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function getServerIsDesktopViewport(): boolean {
  return false;
}

/**
 * Tiny matchMedia hook local to this file (plan Task 3.5). Subscribes to the
 * `md:` breakpoint (768px, matching the codebase's `md:` Tailwind gate) via
 * `useSyncExternalStore` so `numberOfMonths` can flip 2⇄1 live on viewport
 * resize without a resize-listener + effect dance. `getServerIsDesktopViewport`
 * is a CSR-only guard (this is a Vite SPA, see `frontend/src/lib/theme.tsx`
 * for the same `typeof window` convention, though that file predates
 * `useSyncExternalStore` and uses a plain effect instead) — not real SSR
 * support.
 *
 * No existing hand-rolled shared media-query hook was found in this codebase
 * (checked `theme.tsx`, `InstallBanner.tsx`) when this was first written.
 * `@base-ui/react` does ship `unstable-use-media-query` — still marked
 * unstable in the version this repo pins, so it was deliberately not reached
 * for here; this hook stays hand-rolled until that API stabilizes.
 */
function useIsDesktopViewport(): boolean {
  return useSyncExternalStore(
    subscribeToDesktopViewport,
    getIsDesktopViewport,
    getServerIsDesktopViewport,
  );
}

const triggerBaseClasses =
  "cursor-pointer text-left focus:outline-hidden disabled:cursor-default";

const variantClasses = {
  boxed:
    "rounded-sm border border-outline-variant bg-surface-container-lowest px-1.5 py-0.5 font-mono text-[12px] text-on-surface focus:border-primary",
  bare: "border-none bg-transparent text-xs font-semibold text-on-surface",
} as const;

const footerButtonClasses =
  "rounded-sm px-1.5 py-0.5 font-display text-label-caps uppercase tracking-wider text-on-surface-variant hover:bg-surface-container";

/** `formatDisplay(start) – formatDisplay(end)`, em-dash placeholder per missing side. */
function formatRangeDisplay(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  return `${formatDisplay(start) || "—"} – ${formatDisplay(end) || "—"}`;
}

/**
 * Between-style range field for paired START/DUE editing — one two-month
 * range calendar with Apply/Cancel, replacing two separate `DateField`
 * pickers (user add-on, plan Task 3.5, 2026-07-28; reference: ReUI's
 * date-selector *between* mode). The filter operator chips (`is`/`before`/
 * `after`) and Quarter/Half-year granularity pills from that reference are
 * filter grammar, not applicable to a task's start+due pair, and are
 * explicitly excluded — this component is the range calendar only.
 *
 * Day-string contract like `DateField` (see `frontend/src/lib/dateField.ts`):
 * `start`/`end` and the values handed to `onApply` are plain "yyyy-MM-dd"
 * days, not ISO instants — callers convert at the boundary
 * (`InlineDateRangeEditor` and `TaskFormModal`'s edit mode via `commitDraft`; `TaskFormModal`'s create mode via `isoFromDay`).
 *
 * DRAFT ARCHITECTURE (fix round): the draft is a PAIR of day strings —
 * `draftStart`/`draftEnd`, `string | null` each — seeded verbatim from
 * `start`/`end` on every open/reopen, not react-day-picker's `DateRange`
 * object. This matters because RDP's range shape has no representation for
 * "start set, due unset" (or vice versa) that survives an untouched Apply:
 * `{ from: someDate, to: undefined }` is the closest RDP gets, but nothing
 * in RDP v10's `addToRange` ever emits that shape back out of a *committed*
 * selection, so seeding the draft as `{ from: undefined, to: theDay }` for a
 * due-only task and reading `draft?.from`/`draft?.to` back out on Apply is
 * NOT viable — an untouched due-only task would Apply as `(null, null)`,
 * silently deleting its due date. Keeping the pair itself as the source of
 * truth sidesteps this: `rangeFromPair`/`pairFromRange` (`frontend/src/lib/dateField.ts`)
 * translate to/from RDP's shape only for the `Calendar`'s `selected` prop and
 * its `onSelect` callback — Apply always emits the pair directly, so an
 * untouched session (open → Apply, no calendar interaction) reproduces the
 * seeded `start`/`end` byte-identically, including the due-only case (a null
 * start passes through as null).
 *
 * Every calendar interaction updates the draft pair only — nothing reaches
 * the caller until Apply. Cancel, outside-click, and Escape are all reported
 * uniformly through Base-UI's Popover `onOpenChange(false, ...)` and discard
 * the draft + call `onCancel`.
 *
 * Capability trade-off (documented, not solved — see CHANGELOG): because a
 * first click into an EMPTY selection sets both `from` and `to` to the
 * clicked day (RDP's `addToRange` with `min` left at its default of 0), this
 * between-style calendar can no longer interactively CREATE a fresh one-sided
 * date (start-only or due-only) the way the old two-field form could.
 * Existing one-sided data is unaffected — it survives an untouched Apply via
 * the seeded-pair architecture above — and Clear always resets both sides
 * together.
 */
export function DateRangeField({
  start,
  end,
  onApply,
  onCancel,
  disabled = false,
  variant = "boxed",
  clearable = false,
  defaultOpen = false,
  className,
  "aria-label": ariaLabel,
}: DateRangeFieldProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [draftStart, setDraftStart] = useState<string | null>(start);
  const [draftEnd, setDraftEnd] = useState<string | null>(end);
  // Snapshot of `start`/`end` at the exact moment the draft was last seeded
  // (mount init here + the reopen branch in `handleOpenChange` below) — NOT
  // the live props. `handleApply` compares against this snapshot, not
  // `start`/`end` directly; see its comment for the seed-race this guards
  // against.
  const [seedStart, setSeedStart] = useState<string | null>(start);
  const [seedEnd, setSeedEnd] = useState<string | null>(end);
  const isDesktop = useIsDesktopViewport();

  // Hoisted once per render, no non-null assertions — feeds `selected` and
  // `defaultMonth` below.
  const selected = rangeFromPair(draftStart, draftEnd);
  const defaultMonth = dayToDate(draftStart ?? draftEnd) ?? undefined;

  function handleOpenChange(next: boolean) {
    if (next) {
      // Reopening: reseed the draft PAIR from the live props so a previously
      // cancelled edit never leaks into the next open, and so an untouched
      // session always starts from exactly what's persisted. `seedStart`/
      // `seedEnd` are snapshotted here too — same values, but captured once
      // rather than read live later (see `handleApply`'s comment).
      setDraftStart(start);
      setDraftEnd(end);
      setSeedStart(start);
      setSeedEnd(end);
      setOpen(true);
      return;
    }
    // Every dismissal Base-UI reports here — outside click, Escape, or the
    // trigger toggling closed — is a discard. `handleApply` below closes the
    // popover directly (not through this handler), so Apply is never
    // mistaken for a cancel.
    setOpen(false);
    onCancel?.();
  }

  function handleSelect(range: DateRange | undefined) {
    // BLOCKER FIX (fix round 2): `range === undefined` is RDP's own
    // re-click-to-DESELECT signal, not a user request to wipe the draft — it
    // fires on a click on a one-sided draft's or any milestone's single
    // highlighted day just as ordinarily as any other click (see
    // `nextDraftFromSelection`'s doc in dateField.ts for the full RDP
    // mechanism). `nextDraftFromSelection` ignores that signal and returns
    // the current draft unchanged; the Clear button below remains the ONLY
    // path to a both-null draft.
    const [nextStart, nextEnd] = nextDraftFromSelection(range, [draftStart, draftEnd]);
    setDraftStart(nextStart);
    setDraftEnd(nextEnd);
  }

  function handleApply() {
    // Emit the draft PAIR, ordering-corrected — never re-derive from an RDP
    // `DateRange` object. `normalizePair` (dateField.ts) swaps
    // draftStart/draftEnd only when the user actually changed something AND
    // the result is inverted (draftStart > draftEnd); this is what makes an
    // untouched open→Apply byte-identical to the seeded pair, including the
    // due-only case (a null draftStart passes through as null instead of
    // being coerced by an RDP round-trip) AND the historically-inverted-pair
    // case (an untouched Apply on `startDate > dueDate` still emits those
    // seeds verbatim, preserving `commitDraft`'s untouched-passthrough
    // byte-parity at the caller — see `normalizePair`'s doc).
    //
    // SEED RACE FIX (fix round 3): compared against `seedStart`/`seedEnd` —
    // snapshotted at the exact moment the draft was last seeded (mount init
    // + the reopen branch in `handleOpenChange`) — never the live `start`/
    // `end` props. TreeCells/TaskPanel mount this component `defaultOpen`
    // against live TanStack Query data; if a background refetch updates
    // `start`/`end` while the popover is still open, comparing against the
    // live props instead would make an untouched draft evaluate as
    // "changed" (and could swap an untouched inverted pair the user never
    // asked to reorder) purely because the props moved out from under it.
    const [nextStart, nextEnd] = normalizePair(draftStart, draftEnd, seedStart, seedEnd);
    onApply(nextStart, nextEnd);
    setOpen(false);
  }

  function handleClear() {
    // Resets the DRAFT only — still requires Apply to reach the caller,
    // same as DateField's Clear.
    setDraftStart(null);
    setDraftEnd(null);
  }

  const isOpen = open && !disabled;

  // If `disabled` flips true while the popover is open, force it closed —
  // mirrors DateField.tsx's identical guard.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const defaultAriaLabel =
    start || end ? `Date range, currently ${formatRangeDisplay(start, end)}` : "Date range";

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        aria-label={ariaLabel ?? defaultAriaLabel}
        className={cn(triggerBaseClasses, variantClasses[variant], className)}
      >
        {formatRangeDisplay(start, end)}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        positionerClassName="z-101"
        className="w-auto p-0! shadow-overlay!"
      >
        {/* Stops every click inside the popover — calendar padding, caption,
            footer gaps, AND the Clear/Cancel/Apply buttons themselves (all
            nested inside this div) — from bubbling past the popup to a host
            row's own onClick (e.g. the Gantt tree row's onResourceClick,
            which opens the task drawer underneath the picker). Base-UI's
            Popover renders this content through a Portal to document.body,
            but React's synthetic event system still bubbles through the
            REACT component tree (DateRangeField -> InlineDateRangeEditor ->
            TaskDatesCell -> the Gantt row), not the DOM tree, so the portal
            placement alone doesn't stop it — this stopPropagation does. */}
        <div onClick={(e) => e.stopPropagation()}>
          {/* The pair<->RDP mapping this file relies on (rangeFromPair's
              same-day fabrication for one-sided drafts, and
              nextDraftFromSelection's `if (!range) return current;` deselect
              guard, dateField.ts, called from handleSelect above) depends on
              `min`, `max`, `required`, `resetOnSelect`, and
              `excludeDisabled` ALL staying absent/default here (`min=0`,
              `max=0`, `required=false`, `resetOnSelect=undefined`,
              `excludeDisabled=undefined` — react-day-picker's
              `selection/useRange.js` `select()` and `utils/addToRange.js`).
              Adding any of them changes which branch fires on a same-day
              re-click (e.g. `required` would stop RDP from ever emitting the
              `undefined` deselect signal at all, silently changing what
              `nextDraftFromSelection`'s early return is guarding against) —
              do not add them without re-auditing this file's whole
              draft-pair contract. */}
          <Calendar
            mode="range"
            numberOfMonths={isDesktop ? 2 : 1}
            selected={selected}
            defaultMonth={defaultMonth}
            onSelect={handleSelect}
          />
          <div className="flex items-center justify-between gap-2 border-t border-outline-variant p-1">
            <div>
              {clearable ? (
                <button type="button" onClick={handleClear} className={footerButtonClasses}>
                  Clear
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className={footerButtonClasses}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="rounded-sm bg-primary px-2 py-0.5 font-display text-label-caps uppercase tracking-wider text-on-primary hover:bg-primary-container"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
