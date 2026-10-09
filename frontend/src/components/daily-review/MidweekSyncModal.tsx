// Mid-week sync modal (docs/archive/plans/weekly-sync-highlight-rows.md §4 "Mid-week
// form"): edits the Mid-week half of a customer's WeeklyUpdate row —
// Category and one row per highlight (title, detail, risk, action) — plus
// Health (Wednesday sets it; the Reflection modal can change it again on
// Friday). `highlights` fully replaces the server's list on save, in array
// order (D6) — there is no per-row diffing, so a highlight's local `key` is
// assigned by a counter, never the server `id`. Never sends `status` (D12 of
// the prior tables phase — a Mid-week save must not reopen or otherwise
// touch a Done/Draft row's status). Mounted only while its WeeklySyncRow
// button is open (WeeklySyncRow.tsx), so local state below always starts
// fresh from `customer.weeklyUpdate` for the week being opened — never
// carried over from a previous open or a different week. A week with no
// saved highlights opens with one blank card rather than none, so a TAM
// can start typing immediately.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal } from "@/components/Modal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { weekNumberLabel } from "@/lib/dailyReviewStats";
import { dayFromIso } from "@/lib/dateField";
import { weekKeyOf } from "@/lib/isoWeek";
import { type DailyReviewCustomer, type WeeklyHealth, useSaveWeeklyUpdate } from "@/lib/queries";
import { draftWeeklyHighlights } from "@/lib/weeklyDraft";
import { HealthButtonGroup, SyncField } from "./SyncField";

const MAX_HIGHLIGHTS = 20;

interface HighlightDraft {
  key: string;
  title: string;
  detail: string;
  risk: string;
  action: string;
  detailOpen: boolean;
}

interface DraftState {
  health: WeeklyHealth | null;
  category: string;
  highlights: HighlightDraft[];
}

// Shape common to both `WeeklyHighlight` (server rows, has `id`/`position`
// too) and `WeeklyHighlightInput` (the draft helper's output) — the only
// fields a `HighlightDraft` needs, so one function builds a row from either.
interface HighlightSource {
  title: string;
  detail?: string | null;
  risk?: string | null;
  action?: string | null;
}

function toHighlightDraft(nextKey: () => string, h: HighlightSource): HighlightDraft {
  const detail = h.detail ?? "";
  return {
    key: nextKey(),
    title: h.title,
    detail,
    risk: h.risk ?? "",
    action: h.action ?? "",
    detailOpen: detail !== "",
  };
}

function emptyHighlightDraft(key: string): HighlightDraft {
  return { key, title: "", detail: "", risk: "", action: "", detailOpen: false };
}

function initialState(customer: DailyReviewCustomer, nextKey: () => string): DraftState {
  const u = customer.weeklyUpdate;
  const saved = u?.highlights ?? [];
  return {
    health: u?.health ?? null,
    category: u?.category ?? "",
    // No saved highlights → open with one blank card instead of none, so
    // the form isn't empty of fields to type into.
    highlights: saved.length > 0 ? saved.map((h) => toHighlightDraft(nextKey, h)) : [emptyHighlightDraft(nextKey())],
  };
}

export interface MidweekSyncModalProps {
  customer: DailyReviewCustomer;
  week: { key: string; start: string; days: string[] };
  onClose: () => void;
}

export function MidweekSyncModal({ customer, week, onClose }: MidweekSyncModalProps) {
  const save = useSaveWeeklyUpdate(customer.id);
  const highlightKeyCounter = useRef(0);
  function nextHighlightKey(): string {
    highlightKeyCounter.current += 1;
    return `h${highlightKeyCounter.current}`;
  }

  const [state, setState] = useState<DraftState>(() => initialState(customer, nextHighlightKey));
  const [confirmRedraft, setConfirmRedraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);
  const titleRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());

  useEffect(() => {
    if (!pendingFocusKey) return;
    titleRefs.current.get(pendingFocusKey)?.focus();
    setPendingFocusKey(null);
  }, [pendingFocusKey]);

  const weekNumber = weekNumberLabel(week.key);
  const carryOver = customer.previousWeeklyUpdate;
  const carryOverDay = carryOver ? dayFromIso(carryOver.weekStart) : null;
  const carryOverWeekNumber = carryOverDay ? weekNumberLabel(weekKeyOf(carryOverDay)) : null;

  function patch(p: Partial<DraftState>) {
    setState((prev) => ({ ...prev, ...p }));
  }

  function patchHighlight(key: string, p: Partial<HighlightDraft>) {
    setState((prev) => ({
      ...prev,
      highlights: prev.highlights.map((h) => (h.key === key ? { ...h, ...p } : h)),
    }));
  }

  function addHighlight() {
    const key = nextHighlightKey();
    setState((prev) => ({ ...prev, highlights: [...prev.highlights, emptyHighlightDraft(key)] }));
    setPendingFocusKey(key);
  }

  function removeHighlight(key: string) {
    setState((prev) => ({ ...prev, highlights: prev.highlights.filter((h) => h.key !== key) }));
  }

  function applyDraft() {
    // One note can draft to more than MAX_HIGHLIGHTS rows (every project's
    // notes plus operations notes, across three days) — cut the draft at
    // the cap rather than let a save-time rejection surprise the user.
    const drafted = draftWeeklyHighlights(customer, week, { throughDay: week.days[2] }).slice(0, MAX_HIGHLIGHTS);
    // A week with no Mon–Wed notes drafts to nothing — keep one blank card
    // rather than empty the form (same rule as initialState).
    const rows =
      drafted.length > 0
        ? drafted.map((h) => toHighlightDraft(nextHighlightKey, h))
        : [emptyHighlightDraft(nextHighlightKey())];
    setState((prev) => ({ ...prev, highlights: rows }));
  }

  function requestDraft() {
    // The blank starter card (initialState) has no text in any field, so
    // it shouldn't trigger a "replace?" confirm — only a card that already
    // carries something worth losing does.
    const hasContent = state.highlights.some(
      (h) => h.title.trim() !== "" || h.detail.trim() !== "" || h.risk.trim() !== "" || h.action.trim() !== "",
    );
    if (hasContent) {
      setConfirmRedraft(true);
    } else {
      applyDraft();
    }
  }

  function submit() {
    setError(null);
    const kept = state.highlights.filter((h) => {
      const titleEmpty = h.title.trim() === "";
      const restEmpty = h.detail.trim() === "" && h.risk.trim() === "" && h.action.trim() === "";
      return !(titleEmpty && restEmpty);
    });
    if (kept.some((h) => h.title.trim() === "")) {
      setError("Every highlight needs a title.");
      return;
    }
    if (kept.length > MAX_HIGHLIGHTS) {
      setError("20 highlights max — remove some before saving.");
      return;
    }
    save.mutate(
      {
        weekStart: week.start,
        health: state.health,
        category: state.category,
        highlights: kept.map((h) => ({ title: h.title.trim(), detail: h.detail, risk: h.risk, action: h.action })),
      },
      {
        onSuccess: () => onClose(),
        onError: (e) => setError(e instanceof Error ? e.message : "Failed to save the mid-week sync."),
      },
    );
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  const fieldId = (name: string) => `midweek-${customer.id}-${name}`;
  const linkClass =
    "text-[12px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

  // Modal.tsx registers one document-level Escape listener per open
  // instance with no stopPropagation, so a single Escape press would
  // otherwise close both the ConfirmModal and this form underneath it,
  // discarding the edit. While the redraft confirm is open, make this
  // form's own Escape/backdrop-close a no-op so only the confirm closes.
  return (
    <Modal
      open
      onClose={save.isPending || confirmRedraft ? () => {} : onClose}
      title={`Mid-week sync — ${customer.name}, week ${weekNumber}`}
      widthClass="max-w-3xl"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={save.isPending}
            className="rounded-lg border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={save.isPending}
            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60"
          >
            {save.isPending ? "Saving…" : "Save mid-week"}
          </button>
        </>
      }
    >
      <>
        <div className="space-y-4" onKeyDown={handleKeyDown}>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* D11 in docs/archive/plans/weekly-sync-achievement-rows.md — carry-over panel: last Friday's achievement rows that still
              carry an open item (an Outstanding issue, a Next week focus, or
              a Manager decision) — read-only, one block per row, each
              showing only the texts that row actually has. Hidden when last
              week had no such row. */}
          {carryOver && carryOver.achievements.length > 0 && (
            <div className="rounded-sm border border-outline-variant bg-surface-container p-3">
              <p className="mb-2 font-display text-label-caps uppercase text-on-surface-variant">
                From last Friday · Week {carryOverWeekNumber} · {carryOver.achievements.length}{" "}
                {carryOver.achievements.length === 1 ? "item" : "items"}
              </p>
              <div className="flex flex-col gap-2">
                {carryOver.achievements.map((a, index) => (
                  <div
                    key={index}
                    className={
                      index > 0
                        ? "flex flex-col gap-1 border-t border-outline-variant pt-2"
                        : "flex flex-col gap-1"
                    }
                  >
                    <p className="text-[13px] font-semibold text-on-surface">{a.title}</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[150px_1fr]">
                      {a.outstandingIssue && (
                        <>
                          <span className="text-[12px] font-semibold text-on-surface-variant">
                            Outstanding issue
                          </span>
                          <span className="text-sm text-on-surface">{a.outstandingIssue}</span>
                        </>
                      )}
                      {a.nextWeekFocus && (
                        <>
                          <span className="text-[12px] font-semibold text-on-surface-variant">Next week focus</span>
                          <span className="text-sm text-on-surface">{a.nextWeekFocus}</span>
                        </>
                      )}
                      {a.managerDecision && (
                        <>
                          <span className="text-[12px] font-semibold text-on-surface-variant">Manager decision</span>
                          <span className="text-sm text-on-surface">{a.managerDecision}</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
              Health
            </p>
            <HealthButtonGroup value={state.health} onChange={(health) => patch({ health })} />
          </div>

          <SyncField id={fieldId("category")} label="Category" helper="One line. 120 characters max.">
            <Input
              id={fieldId("category")}
              value={state.category}
              onChange={(e) => patch({ category: e.target.value })}
              maxLength={120}
              aria-label={`Category for ${customer.name}`}
            />
          </SyncField>

          <div className="space-y-2.5">
            <div>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <p className="block font-display text-label-caps uppercase text-on-surface-variant">
                  Highlights
                </p>
                <button type="button" onClick={requestDraft} className={linkClass}>
                  Draft from Mon–Wed notes
                </button>
              </div>
              <p className="text-xs text-on-surface-variant">
                One row in Monday&rsquo;s table per highlight. Title: one line, 200 characters max. Detail shows in
                the form and in Copy as table, not in the table on screen.
              </p>
            </div>

            {state.highlights.map((h, index) => {
              const n = index + 1;
              const titleId = fieldId(`h${n}-title`);
              const riskId = fieldId(`h${n}-risk`);
              const actionId = fieldId(`h${n}-action`);
              const detailId = fieldId(`h${n}-detail`);
              return (
                <div
                  key={h.key}
                  data-testid={`midweek-highlight-${n}`}
                  className="space-y-2.5 rounded-sm border border-outline-variant bg-surface-container-low p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-label-caps uppercase text-on-surface-variant">
                      Highlight {n}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeHighlight(h.key)}
                      aria-label={`Remove highlight ${n}`}
                      className="text-[12px] font-semibold text-on-surface-variant hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    >
                      Remove
                    </button>
                  </div>

                  <SyncField id={titleId} label="Title">
                    <Input
                      id={titleId}
                      ref={(el) => {
                        titleRefs.current.set(h.key, el);
                      }}
                      value={h.title}
                      onChange={(e) => patchHighlight(h.key, { title: e.target.value })}
                      maxLength={200}
                      aria-label={`Highlight ${n} title for ${customer.name}`}
                    />
                  </SyncField>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <SyncField id={riskId} label="Risk">
                      <Textarea
                        id={riskId}
                        value={h.risk}
                        onChange={(e) => patchHighlight(h.key, { risk: e.target.value })}
                        aria-label={`Highlight ${n} risk for ${customer.name}`}
                        className="min-h-16"
                      />
                    </SyncField>
                    <SyncField id={actionId} label="Action">
                      <Textarea
                        id={actionId}
                        value={h.action}
                        onChange={(e) => patchHighlight(h.key, { action: e.target.value })}
                        aria-label={`Highlight ${n} action for ${customer.name}`}
                        className="min-h-16"
                      />
                    </SyncField>
                  </div>

                  {h.detailOpen ? (
                    <SyncField id={detailId} label="Detail">
                      <Textarea
                        id={detailId}
                        value={h.detail}
                        onChange={(e) => patchHighlight(h.key, { detail: e.target.value })}
                        aria-label={`Highlight ${n} detail for ${customer.name}`}
                        className="min-h-[120px]"
                      />
                    </SyncField>
                  ) : (
                    <button
                      type="button"
                      onClick={() => patchHighlight(h.key, { detailOpen: true })}
                      className={linkClass}
                    >
                      Add detail
                    </button>
                  )}
                </div>
              );
            })}

            <div className="flex flex-col items-start gap-1">
              <button
                type="button"
                onClick={addHighlight}
                disabled={state.highlights.length >= MAX_HIGHLIGHTS}
                className="flex items-center gap-1.5 rounded-sm border border-outline-variant px-2.5 py-1.5 text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                  add
                </span>
                Add highlight
              </button>
              {state.highlights.length >= MAX_HIGHLIGHTS && (
                <p className="text-xs text-on-surface-variant">20 highlights max.</p>
              )}
            </div>
          </div>
        </div>

        <ConfirmModal
          open={confirmRedraft}
          onClose={() => setConfirmRedraft(false)}
          onConfirm={() => {
            applyDraft();
            setConfirmRedraft(false);
          }}
          title="Draft from Mon–Wed notes"
          body="Replace the highlights with a draft from this week's notes?"
          confirmLabel="Draft"
          confirmTone="warning"
        />
      </>
    </Modal>
  );
}
