// Shared Mon..Sun note editor (spec §6.3: project cards' week rows and the
// operations card's week rows are the same shape — day label, existing
// note(s) or "No note", Edit/Add, today's row always an input). One
// generic component drives both call sites; `renderPrefix`/`renderExtraFields`/
// `extraValid` are the only operations-specific hooks (the required Title
// field and its prefix on saved rows).
//
// The week rows are collapsible (Decision 16, daily-review-v2-spec.md §3):
// default collapsed, showing only today's row (its saved notes + the
// input) plus a "Show week · N notes" / "Hide week" toggle in the "This
// week" caps header. A week with no "today" in `days` (a past/future week)
// has no persistent today row, so it defaults EXPANDED instead — a
// collapsed shell with nothing in it would be useless. The caller keys this
// component by the week (e.g. `days[0]`) so switching weeks remounts it
// fresh rather than carrying stale collapsed/expanded state across weeks.
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { dayLabel } from "@/lib/dailyReviewStats";
import { dayFromIso } from "@/lib/dateField";

export interface WeekNoteBase {
  id: number;
  /** ISO instant (`"yyyy-MM-ddT00:00:00.000Z"`), NOT a bare day string — compare via `dayFromIso`, never `===` against a `days[]` entry. */
  noteDate: string;
  body: string;
  author: { id: number; username: string };
}

/** Operations-only fields, folded into every add/update call for uniformity — a plain ProjectNote caller ignores them. */
export interface WeekNoteExtra {
  title: string;
}

const EMPTY_EXTRA: WeekNoteExtra = { title: "" };

export interface WeekNotesEditorProps<N extends WeekNoteBase> {
  days: string[];
  today: string;
  notes: N[];
  currentUserId: number;
  /** Wildcard users (Decision 9) may delete any note, not just their own. */
  canDeleteAny: boolean;
  placeholder: string;
  ariaLabel: string;
  /** Unique id for the day-rows container, e.g. `week-rows-project-3` / `week-rows-customer-7` — wired to the "Show/Hide week" toggle's `aria-controls`. */
  rowsId: string;
  extraFromNote?: (note: N) => WeekNoteExtra;
  renderExtraFields?: (extra: WeekNoteExtra, setExtra: (next: WeekNoteExtra) => void) => ReactNode;
  /** When given, Save stays disabled (and ⌘/Ctrl+Enter is a no-op) until this returns true — e.g. requiring a non-empty title alongside the body. */
  extraValid?: (extra: WeekNoteExtra) => boolean;
  renderPrefix?: (note: N) => ReactNode;
  onAdd: (day: string, body: string, extra: WeekNoteExtra) => void;
  onUpdate: (noteId: number, body: string, extra: WeekNoteExtra) => void;
  onDelete: (noteId: number) => void;
  addPending: boolean;
  updatePending: boolean;
  deletePending: boolean;
  /** Set (by the page's "first card" only) when a day-strip click should scroll/focus this day's row. */
  focusDay?: string | null;
  focusToken?: number;
  /**
   * Set (e.g. by the iTop daily strip's "Add to note" button, via
   * OperationsCard) to append `text` to today's draft note. A fresh `token`
   * re-triggers the effect even when `text` repeats (e.g. the same ticket
   * added twice) — see DailyItopStrip.tsx. The owner (OperationsCard) is
   * responsible for clearing this back to `null` via
   * `onPendingInsertApplied` once applied — this component only tracks
   * "did I already act on THIS `pendingInsert` object", not "has this ever
   * been applied", so a caller that never clears it would see the insert
   * re-fire the moment this editor remounts (e.g. on a week switch, which
   * remounts it fresh via the `key={days[0]}` at both call sites).
   */
  pendingInsert?: { text: string; token: number } | null;
  onPendingInsertApplied?: () => void;
}

type ActiveEdit = { kind: "add"; day: string } | { kind: "edit"; noteId: number };


// Same order as the daily-review cache (`compareNotesByDayThenId` in
// lib/queries.ts): saved notes by id ascending, then optimistic notes
// (negative temp ids) last, newest last — so a just-saved note does not
// jump from the top of its day to the bottom once the refetch lands.
function compareNotesById(a: { id: number }, b: { id: number }): number {
  const aTemp = a.id < 0, bTemp = b.id < 0;
  if (aTemp !== bTemp) return aTemp ? 1 : -1;
  return aTemp ? b.id - a.id : a.id - b.id;
}

export function WeekNotesEditor<N extends WeekNoteBase>({
  days,
  today,
  notes,
  currentUserId,
  canDeleteAny,
  placeholder,
  ariaLabel,
  rowsId,
  extraFromNote,
  renderExtraFields,
  extraValid,
  renderPrefix,
  onAdd,
  onUpdate,
  onDelete,
  addPending,
  updatePending,
  deletePending,
  focusDay,
  focusToken,
  pendingInsert,
  onPendingInsertApplied,
}: WeekNotesEditorProps<N>) {
  // Today's row is a persistent, always-visible "add" input — kept in its
  // own state so it's never clobbered by opening/closing an edit/add
  // operation on a past day (and vice versa).
  const [todayBody, setTodayBody] = useState("");
  const [todayExtra, setTodayExtra] = useState<WeekNoteExtra>(EMPTY_EXTRA);
  const todayTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [activeEdit, setActiveEdit] = useState<ActiveEdit | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editExtra, setEditExtra] = useState<WeekNoteExtra>(EMPTY_EXTRA);

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const hasTodayRow = days.includes(today);
  // Decision 16: default collapsed to just today's row — UNLESS this week
  // has no today row at all (a past/future week), where a collapsed shell
  // would show nothing. Lazy initializer: the caller keys this component by
  // the week (`days[0]`), so a week change remounts it and re-evaluates
  // this rather than carrying stale state across weeks.
  const [weekExpanded, setWeekExpanded] = useState(() => !hasTodayRow);
  // The most recent focus-request token the user explicitly collapsed back
  // past — without this, `weekExpanded` being an effect dependency means
  // every manual "Hide week" click re-fires the effect against the SAME
  // (never-cleared, see DailyReview.tsx's `focusRequest`) focus day/token
  // and immediately re-expands it. A fresh day-strip click always carries a
  // new token, so it still expands + focuses despite a prior dismissal.
  const [dismissedFocusToken, setDismissedFocusToken] = useState<number | null>(null);

  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const visibleDays = weekExpanded ? days : days.filter((day) => day === today);
  const todayNoteCount = notes.filter((n) => dayFromIso(n.noteDate) === today).length;
  // N in "Show week · N notes" — notes on the days hidden while collapsed.
  // With no today row (a past week), every day is hidden, so N is every note.
  const hiddenNoteCount = hasTodayRow ? notes.length - todayNoteCount : notes.length;

  useEffect(() => {
    if (!focusDay || focusToken === dismissedFocusToken) return;
    // The target day's row doesn't exist in the DOM yet while the week is
    // collapsed (unless it's today's row, always rendered) — expand first
    // and let this effect re-run (via the `weekExpanded` dependency) once
    // the row is actually there to scroll/focus.
    if (!weekExpanded && focusDay !== today) {
      setWeekExpanded(true);
      return;
    }
    const el = rowRefs.current[focusDay];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus({ preventScroll: true });
    // Re-fire on every click, even the same day twice — `focusToken` (not
    // just `focusDay`) is the dependency that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDay, focusToken, weekExpanded, dismissedFocusToken]);

  useEffect(() => {
    if (!pendingInsert) return;
    setTodayBody((prev) => (prev.trim().length > 0 ? `${prev}\n${pendingInsert.text}` : pendingInsert.text));
    // Today's row is always rendered regardless of `weekExpanded` (it's
    // filtered into `visibleDays` unconditionally below), but expand the
    // week too so the freshly-appended text sits in its full context rather
    // than a collapsed shell.
    setWeekExpanded(true);
    // The textarea may not be mounted/updated yet on this same tick — wait a
    // frame so `todayTextareaRef` has the latest DOM node before focusing.
    requestAnimationFrame(() => todayTextareaRef.current?.focus());
    // Tell the owner this insert was applied so it clears `pendingInsert`
    // back to `null` — this effect has no memory of its own across a
    // remount (e.g. a week switch, which recreates this whole component via
    // the `key={days[0]}` both call sites use), so a caller that never
    // clears it would see this same insert re-apply on the next mount.
    onPendingInsertApplied?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInsert]);

  function toggleWeek() {
    // Dismiss the in-flight focus token when COLLAPSING, or the effect
    // above would immediately re-expand the week on its next run.
    if (weekExpanded) setDismissedFocusToken(focusToken ?? null);
    setWeekExpanded((v) => !v);
  }

  function startAdd(day: string) {
    setActiveEdit({ kind: "add", day });
    setEditBody("");
    setEditExtra(EMPTY_EXTRA);
  }

  function startEdit(note: N) {
    setActiveEdit({ kind: "edit", noteId: note.id });
    setEditBody(note.body);
    setEditExtra(extraFromNote ? extraFromNote(note) : EMPTY_EXTRA);
  }

  function saveActiveEdit() {
    const trimmed = editBody.trim();
    if (!trimmed || !activeEdit || (extraValid && !extraValid(editExtra))) return;
    if (activeEdit.kind === "add") onAdd(activeEdit.day, trimmed, editExtra);
    else onUpdate(activeEdit.noteId, trimmed, editExtra);
    setActiveEdit(null);
  }

  function saveToday() {
    const trimmed = todayBody.trim();
    if (!trimmed || (extraValid && !extraValid(todayExtra))) return;
    onAdd(today, trimmed, todayExtra);
    setTodayBody("");
    setTodayExtra(EMPTY_EXTRA);
  }

  function handleDelete(noteId: number) {
    setConfirmDeleteId(noteId);
  }

  function confirmDelete() {
    if (confirmDeleteId === null) return;
    onDelete(confirmDeleteId);
    if (activeEdit?.kind === "edit" && activeEdit.noteId === confirmDeleteId) setActiveEdit(null);
    setConfirmDeleteId(null);
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
          This week
        </span>
        <button
          type="button"
          onClick={toggleWeek}
          aria-expanded={weekExpanded}
          aria-controls={rowsId}
          className="text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          {weekExpanded
            ? "Hide week"
            : hiddenNoteCount > 0
              ? `Show week · ${hiddenNoteCount} note${hiddenNoteCount === 1 ? "" : "s"}`
              : "Show week"}
        </button>
      </div>
      <div id={rowsId} className="divide-y divide-outline-variant">
        {visibleDays.map((day) => {
          const dayNotes = notes.filter((n) => dayFromIso(n.noteDate) === day).sort(compareNotesById);
          const isToday = day === today;
          const isAddingThisDay = activeEdit?.kind === "add" && activeEdit.day === day;

          return (
            <div
              key={day}
              ref={(el) => {
                rowRefs.current[day] = el;
              }}
              tabIndex={-1}
              className="flex flex-col gap-2 py-2.5 outline-none first:pt-0 last:pb-0 md:flex-row md:gap-3"
            >
              <div className="shrink-0 pt-1 font-mono text-xs tabular-nums text-on-surface-variant md:w-16">
                {dayLabel(day)}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                {dayNotes.map((note) =>
                  activeEdit?.kind === "edit" && activeEdit.noteId === note.id ? (
                    <NoteEditorForm
                      key={note.id}
                      value={editBody}
                      onChange={setEditBody}
                      extra={editExtra}
                      onExtraChange={setEditExtra}
                      renderExtraFields={renderExtraFields}
                      extraValid={extraValid}
                      placeholder={placeholder}
                      ariaLabel={ariaLabel}
                      onSave={saveActiveEdit}
                      onCancel={() => setActiveEdit(null)}
                      onDelete={() => handleDelete(note.id)}
                      saving={updatePending}
                      deleting={deletePending}
                    />
                  ) : (
                    <div key={note.id} className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {renderPrefix?.(note)}
                        <p className="whitespace-pre-wrap text-sm text-on-surface">{note.body}</p>
                        <p className="text-[11px] text-on-surface-variant">{note.author.username}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {note.author.id === currentUserId && (
                          <button
                            type="button"
                            onClick={() => startEdit(note)}
                            className="text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                          >
                            Edit
                          </button>
                        )}
                        {canDeleteAny && note.author.id !== currentUserId && (
                          <button
                            type="button"
                            onClick={() => handleDelete(note.id)}
                            className="text-[11px] font-semibold text-error hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ),
                )}

                {!isToday && dayNotes.length === 0 && !isAddingThisDay && (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm italic text-on-surface-variant">No note</p>
                    <button
                      type="button"
                      onClick={() => startAdd(day)}
                      className="shrink-0 text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    >
                      Add
                    </button>
                  </div>
                )}

                {!isToday && dayNotes.length > 0 && !isAddingThisDay && (
                  <button
                    type="button"
                    onClick={() => startAdd(day)}
                    className="text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    + Add another note
                  </button>
                )}

                {!isToday && isAddingThisDay && (
                  <NoteEditorForm
                    value={editBody}
                    onChange={setEditBody}
                    extra={editExtra}
                    onExtraChange={setEditExtra}
                    renderExtraFields={renderExtraFields}
                    extraValid={extraValid}
                    placeholder={placeholder}
                    ariaLabel={ariaLabel}
                    onSave={saveActiveEdit}
                    onCancel={() => setActiveEdit(null)}
                    saving={addPending}
                  />
                )}

                {isToday && (
                  <NoteEditorForm
                    value={todayBody}
                    onChange={setTodayBody}
                    extra={todayExtra}
                    onExtraChange={setTodayExtra}
                    renderExtraFields={renderExtraFields}
                    extraValid={extraValid}
                    placeholder={placeholder}
                    ariaLabel={ariaLabel}
                    onSave={saveToday}
                    saving={addPending}
                    textareaRef={todayTextareaRef}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmModal
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={confirmDelete}
        title="Delete note"
        body="Delete this note? This can't be undone."
        confirmLabel="Delete"
        confirmTone="warning"
      />
    </div>
  );
}

function NoteEditorForm({
  value,
  onChange,
  extra,
  onExtraChange,
  renderExtraFields,
  extraValid,
  placeholder,
  ariaLabel,
  onSave,
  onCancel,
  onDelete,
  saving,
  deleting,
  textareaRef,
}: {
  value: string;
  onChange: (v: string) => void;
  extra: WeekNoteExtra;
  onExtraChange: (e: WeekNoteExtra) => void;
  renderExtraFields?: (extra: WeekNoteExtra, setExtra: (next: WeekNoteExtra) => void) => ReactNode;
  extraValid?: (extra: WeekNoteExtra) => boolean;
  placeholder: string;
  ariaLabel: string;
  onSave: () => void;
  onCancel?: () => void;
  onDelete?: () => void;
  saving?: boolean;
  deleting?: boolean;
  /** Only passed for the persistent "today" row — see WeekNotesEditor's `pendingInsert` effect. */
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  const disabled = value.trim().length === 0 || saving || (extraValid ? !extraValid(extra) : false);
  return (
    <div className="space-y-2 rounded-sm border border-outline-variant bg-surface p-2">
      {renderExtraFields?.(extra, onExtraChange)}
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onSave();
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        rows={3}
        className="min-h-16"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <KbdGroup className="text-[11px] text-on-surface-variant">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd>
          <span className="ml-1">saves</span>
        </KbdGroup>
        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="text-[12px] font-semibold text-error hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              Delete
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-sm border border-outline-variant px-3 py-1.5 font-display text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={disabled}
            className="rounded-sm bg-primary px-3 py-1.5 font-display text-[12px] font-semibold text-on-primary hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {saving ? "Saving…" : "Save note"}
          </button>
        </div>
      </div>
    </div>
  );
}
