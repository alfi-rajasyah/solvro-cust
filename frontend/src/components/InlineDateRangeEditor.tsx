import { DateRangeField } from "@/components/DateRangeField";
import { commitDraft, dayFromIso } from "@/lib/dateField";

interface InlineDateRangeEditorProps {
  startISO: string | null;
  endISO: string | null;
  onSave: (startISO: string | null, endISO: string | null) => void;
  onCancel: () => void;
  /** Optional positional className (e.g. "absolute right-0 top-full mt-1 z-50"). */
  className?: string;
}

/**
 * Thin wrapper around `DateRangeField` (plan Task 3.5, 2026-07-28 user
 * add-on): both call sites (`TaskPanel.tsx`'s DATES editor, the Gantt tree's
 * `TreeCells.tsx`) mount this component only once editing begins, so
 * `defaultOpen` opens the two-month range calendar immediately — one less
 * click than the old two-field form. External contract (`startISO`/
 * `endISO`/`onSave`/`onCancel`/`className`) is unchanged, so neither call
 * site needs edits.
 *
 * `startISO`/`endISO` are the persisted ISO instants; `DateRangeField`
 * itself only traffics in day strings, so this wrapper is the ISO boundary:
 * `dayFromIso` seeds the field's `start`/`end`, and `commitDraft` — per
 * endpoint, exactly as before this task — reconciles each side of the
 * applied draft against its original ISO on the way back out, preserving
 * the untouched-field passthrough: byte-identical in/out for a field the
 * user didn't touch, and what keeps a pre-fix non-midnight-UTC instant
 * stable until `backend/scripts/normalize-day-dates.ts` repairs it.
 *
 * The old two-field shell, its own Save/Cancel buttons, the hand-rolled
 * outside-click/Escape document listeners, and the submit-time end<start
 * clamp are all gone — range mode enforces start ≤ end structurally, and
 * Base-UI's Popover dismiss (outside-click, Escape, or Cancel) is what
 * `DateRangeField`'s `onCancel` already covers.
 *
 * `className` (fix round): positions the whole editor via a wrapping `span`
 * rather than forwarding straight through to `DateRangeField`'s own
 * `className` prop. `gantt-v2/TreeCells.tsx` passes a float-below-row
 * positioning class (`"absolute right-0 top-full z-50 mt-1"`), mirroring the
 * old form-shell's own placement — its outer `<form>` carried the same
 * classes (`git show 88c7590^:frontend/src/components/InlineDateRangeEditor.tsx`).
 * `DateRangeField.className` is documented as "extra classes on the trigger
 * button" — a styling hook, not a positioning one — so forwarding
 * caller-supplied layout classes straight into it conflated two different
 * concerns (this wrapper's placement vs. the trigger's own look) and made
 * that placement fragile to any future change in `DateRangeField`'s trigger
 * markup. The wrapping `span` gives the caller its own dedicated
 * positioning surface, decoupled from the trigger's styling, and the
 * trigger renders with no positional classes of its own.
 */
export function InlineDateRangeEditor({
  startISO,
  endISO,
  onSave,
  onCancel,
  className = "",
}: InlineDateRangeEditorProps) {
  return (
    <span className={className}>
      <DateRangeField
        start={dayFromIso(startISO)}
        end={dayFromIso(endISO)}
        onApply={(draftStart, draftEnd) => {
          onSave(commitDraft(draftStart, startISO), commitDraft(draftEnd, endISO));
        }}
        onCancel={onCancel}
        defaultOpen
        clearable
      />
    </span>
  );
}
