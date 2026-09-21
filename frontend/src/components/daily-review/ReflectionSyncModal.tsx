// Reflection sync modal (docs/archive/plans/weekly-sync-achievement-rows.md §4
// "Reflection form", T5): edits the Reflection half of a customer's
// WeeklyUpdate row — Health, plus one row per achievement, each carrying
// its own Title, Detail, Outstanding issue, Lesson learned, Next week focus
// and Need manager decision (D1/D2). `achievements` fully replaces the
// server's list on save, in array order (D6) — there is no per-row
// diffing, so an achievement's local `key` is assigned by a counter, never
// the server `id`. Also owns the Draft/Done transition (D7: Done needs an
// effective health and at least one kept achievement with a non-blank
// title) and reopening a Done row back to Draft. Mounted only while its
// WeeklySyncRow button is open (WeeklySyncRow.tsx), same fresh-local-state
// rule as MidweekSyncModal.tsx. A week with no saved achievements opens
// with one blank card rather than none, so a TAM can start typing
// immediately.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal } from "@/components/Modal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { weekNumberLabel } from "@/lib/dailyReviewStats";
import { type DailyReviewCustomer, type WeeklyHealth, type WeeklyStatus, useSaveWeeklyUpdate } from "@/lib/queries";
import { draftWeeklyAchievements } from "@/lib/weeklyDraft";
import { HealthButtonGroup, SyncField } from "./SyncField";

const MAX_ACHIEVEMENTS = 20;

interface AchievementDraft {
  key: string;
  title: string;
  detail: string;
  outstandingIssue: string;
  lessonLearned: string;
  nextWeekFocus: string;
  managerDecision: string;
  detailOpen: boolean;
}

interface DraftState {
  health: WeeklyHealth | null;
  achievements: AchievementDraft[];
}

// Shape common to both `WeeklyAchievement` (server rows, has `id`/`position`
// too) and `WeeklyAchievementInput` (the draft helper's output) — the only
// fields an `AchievementDraft` needs, so one function builds a row from
// either.
interface AchievementSource {
  title: string;
  detail?: string | null;
  outstandingIssue?: string | null;
  lessonLearned?: string | null;
  nextWeekFocus?: string | null;
  managerDecision?: string | null;
}

function toAchievementDraft(nextKey: () => string, a: AchievementSource): AchievementDraft {
  const detail = a.detail ?? "";
  return {
    key: nextKey(),
    title: a.title,
    detail,
    outstandingIssue: a.outstandingIssue ?? "",
    lessonLearned: a.lessonLearned ?? "",
    nextWeekFocus: a.nextWeekFocus ?? "",
    managerDecision: a.managerDecision ?? "",
    detailOpen: detail !== "",
  };
}

function emptyAchievementDraft(key: string): AchievementDraft {
  return {
    key,
    title: "",
    detail: "",
    outstandingIssue: "",
    lessonLearned: "",
    nextWeekFocus: "",
    managerDecision: "",
    detailOpen: false,
  };
}

/** True when `a` carries no text in any of its six fields — the blank starter card, or a card the user cleared back out. */
function isBlankAchievement(a: AchievementDraft): boolean {
  return (
    a.title.trim() === "" &&
    a.detail.trim() === "" &&
    a.outstandingIssue.trim() === "" &&
    a.lessonLearned.trim() === "" &&
    a.nextWeekFocus.trim() === "" &&
    a.managerDecision.trim() === ""
  );
}

/** Drops every entirely-blank card (D6/D7) — the set actually sent on save, and the set `canMarkDone` reads from. */
function keptAchievements(achievements: AchievementDraft[]): AchievementDraft[] {
  return achievements.filter((a) => !isBlankAchievement(a));
}

function initialState(customer: DailyReviewCustomer, nextKey: () => string): DraftState {
  const u = customer.weeklyUpdate;
  const saved = u?.achievements ?? [];
  return {
    health: u?.health ?? null,
    // No saved achievements → open with one blank card instead of none, so
    // the form isn't empty of fields to type into.
    achievements:
      saved.length > 0 ? saved.map((a) => toAchievementDraft(nextKey, a)) : [emptyAchievementDraft(nextKey())],
  };
}

export interface ReflectionSyncModalProps {
  customer: DailyReviewCustomer;
  week: { key: string; start: string; days: string[] };
  onClose: () => void;
}

export function ReflectionSyncModal({ customer, week, onClose }: ReflectionSyncModalProps) {
  const save = useSaveWeeklyUpdate(customer.id);
  const achievementKeyCounter = useRef(0);
  function nextAchievementKey(): string {
    achievementKeyCounter.current += 1;
    return `a${achievementKeyCounter.current}`;
  }

  const [state, setState] = useState<DraftState>(() => initialState(customer, nextAchievementKey));
  const [confirmRedraft, setConfirmRedraft] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);
  const titleRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());

  useEffect(() => {
    if (!pendingFocusKey) return;
    titleRefs.current.get(pendingFocusKey)?.focus();
    setPendingFocusKey(null);
  }, [pendingFocusKey]);

  const weekNumber = weekNumberLabel(week.key);
  const isDone = customer.weeklyUpdate?.status === "DONE";
  const kept = keptAchievements(state.achievements);
  const canMarkDone = state.health !== null && kept.some((a) => a.title.trim() !== "");
  // Same requirement applies whether this is the first "Mark done" or a
  // later "Save" on an already-Done week (D7) — an already-Done row whose
  // health gets cleared or every achievement gets blanked out here must not
  // stay saveable, or the server's 400 (weekly_update_incomplete) is the
  // only thing stopping it.
  const primaryDisabled = save.isPending || !canMarkDone;

  function patch(p: Partial<DraftState>) {
    setState((prev) => ({ ...prev, ...p }));
  }

  function patchAchievement(key: string, p: Partial<AchievementDraft>) {
    setState((prev) => ({
      ...prev,
      achievements: prev.achievements.map((a) => (a.key === key ? { ...a, ...p } : a)),
    }));
  }

  function addAchievement() {
    const key = nextAchievementKey();
    setState((prev) => ({ ...prev, achievements: [...prev.achievements, emptyAchievementDraft(key)] }));
    setPendingFocusKey(key);
  }

  function removeAchievement(key: string) {
    setState((prev) => ({ ...prev, achievements: prev.achievements.filter((a) => a.key !== key) }));
  }

  function applyDraft() {
    // This week's Mid-week highlights plus Thursday-Sunday notes can draft
    // to more than MAX_ACHIEVEMENTS rows — cut the draft at the cap rather
    // than let a save-time rejection surprise the user.
    const drafted = draftWeeklyAchievements(customer, week).slice(0, MAX_ACHIEVEMENTS);
    // Nothing to draft from → keep one blank card rather than empty the
    // form (same rule as initialState).
    const rows =
      drafted.length > 0
        ? drafted.map((a) => toAchievementDraft(nextAchievementKey, a))
        : [emptyAchievementDraft(nextAchievementKey())];
    setState((prev) => ({ ...prev, achievements: rows }));
  }

  function requestDraft() {
    // The blank starter card (initialState) has no text in any field, so it
    // shouldn't trigger a "replace?" confirm — only a card that already
    // carries something worth losing does.
    const hasContent = state.achievements.some((a) => !isBlankAchievement(a));
    if (hasContent) {
      setConfirmRedraft(true);
    } else {
      applyDraft();
    }
  }

  function submit(status: WeeklyStatus) {
    setError(null);
    const rows = keptAchievements(state.achievements);
    if (rows.some((a) => a.title.trim() === "")) {
      setError("Every achievement needs a title.");
      return;
    }
    if (rows.length > MAX_ACHIEVEMENTS) {
      setError("20 achievements max — remove some before saving.");
      return;
    }
    save.mutate(
      {
        weekStart: week.start,
        health: state.health,
        status,
        achievements: rows.map((a) => ({
          title: a.title.trim(),
          detail: a.detail,
          outstandingIssue: a.outstandingIssue,
          lessonLearned: a.lessonLearned,
          nextWeekFocus: a.nextWeekFocus,
          managerDecision: a.managerDecision,
        })),
      },
      {
        onSuccess: () => onClose(),
        onError: (e) => setError(e instanceof Error ? e.message : "Failed to save the reflection sync."),
      },
    );
  }

  function primarySubmit() {
    if (primaryDisabled) return;
    submit("DONE");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      primarySubmit();
    }
  }

  const fieldId = (name: string) => `reflection-${customer.id}-${name}`;
  const linkClass =
    "text-[12px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

  // Modal.tsx registers one document-level Escape listener per open
  // instance with no stopPropagation, so a single Escape press would
  // otherwise close both the open ConfirmModal and this form underneath
  // it, discarding the edit. While either the redraft or reopen confirm is
  // open, make this form's own Escape/backdrop-close a no-op so only the
  // confirm closes.
  return (
    <Modal
      open
      onClose={save.isPending || confirmRedraft || confirmReopen ? () => {} : onClose}
      title={`Reflection sync — ${customer.name}, week ${weekNumber}`}
      widthClass="max-w-3xl"
      footer={
        isDone ? (
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
              onClick={() => setConfirmReopen(true)}
              disabled={save.isPending}
              className="rounded-lg border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
            >
              Reopen as draft
            </button>
            <button
              type="button"
              onClick={primarySubmit}
              disabled={primaryDisabled}
              className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </>
        ) : (
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
              onClick={() => submit("DRAFT")}
              disabled={save.isPending}
              className="rounded-lg border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
            >
              Save draft
            </button>
            <button
              type="button"
              onClick={primarySubmit}
              disabled={primaryDisabled}
              className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {save.isPending ? "Saving…" : "Mark done"}
            </button>
          </>
        )
      }
    >
      <>
        <div className="space-y-4" onKeyDown={handleKeyDown}>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div>
            <p className="mb-1 block font-display text-label-caps uppercase tracking-widest text-on-surface-variant">
              Health
            </p>
            <HealthButtonGroup value={state.health} onChange={(health) => patch({ health })} />
            <p className="mt-1 text-[12px] text-on-surface-variant">
              Set on Wednesday. Change it here if the week ended differently.
            </p>
          </div>

          <div className="space-y-2.5">
            <div>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <p className="block font-display text-label-caps uppercase tracking-widest text-on-surface-variant">
                  Achievements <span className="text-primary">· one needed to mark done</span>
                </p>
                <button type="button" onClick={requestDraft} className={linkClass}>
                  Draft from this week
                </button>
              </div>
              <p className="text-[11px] text-on-surface-variant">
                One row in Monday&rsquo;s table per achievement, with its own Outstanding issue, Lesson learned,
                Next week focus and decision. The draft starts from this week&rsquo;s Mid-week highlights, then
                adds Thursday to Sunday&rsquo;s notes. Title: one line, 200 characters max.
              </p>
            </div>

            {state.achievements.map((a, index) => {
              const n = index + 1;
              const titleId = fieldId(`a${n}-title`);
              const detailId = fieldId(`a${n}-detail`);
              const outstandingId = fieldId(`a${n}-outstanding`);
              const lessonId = fieldId(`a${n}-lesson`);
              const nextWeekId = fieldId(`a${n}-nextweek`);
              const decisionId = fieldId(`a${n}-decision`);
              return (
                <div
                  key={a.key}
                  data-testid={`reflection-achievement-${n}`}
                  className="space-y-2.5 rounded-sm border border-outline-variant bg-surface-container-low p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                      Achievement {n}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAchievement(a.key)}
                      aria-label={`Remove achievement ${n}`}
                      className="text-[12px] font-semibold text-on-surface-variant hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    >
                      Remove
                    </button>
                  </div>

                  <SyncField id={titleId} label="Title">
                    <Input
                      id={titleId}
                      ref={(el) => {
                        titleRefs.current.set(a.key, el);
                      }}
                      value={a.title}
                      onChange={(e) => patchAchievement(a.key, { title: e.target.value })}
                      maxLength={200}
                      aria-label={`Achievement ${n} title for ${customer.name}`}
                    />
                  </SyncField>

                  {a.detailOpen ? (
                    <SyncField id={detailId} label="Detail">
                      <Textarea
                        id={detailId}
                        value={a.detail}
                        onChange={(e) => patchAchievement(a.key, { detail: e.target.value })}
                        aria-label={`Achievement ${n} detail for ${customer.name}`}
                        className="min-h-[96px]"
                      />
                    </SyncField>
                  ) : (
                    <button
                      type="button"
                      onClick={() => patchAchievement(a.key, { detailOpen: true })}
                      className={linkClass}
                    >
                      Add detail
                    </button>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <SyncField id={outstandingId} label="Outstanding issue">
                      <Textarea
                        id={outstandingId}
                        value={a.outstandingIssue}
                        onChange={(e) => patchAchievement(a.key, { outstandingIssue: e.target.value })}
                        aria-label={`Achievement ${n} outstanding issue for ${customer.name}`}
                        className="min-h-16"
                      />
                    </SyncField>
                    <SyncField id={lessonId} label="Lesson learned">
                      <Textarea
                        id={lessonId}
                        value={a.lessonLearned}
                        onChange={(e) => patchAchievement(a.key, { lessonLearned: e.target.value })}
                        aria-label={`Achievement ${n} lesson learned for ${customer.name}`}
                        className="min-h-16"
                      />
                    </SyncField>
                    <SyncField id={nextWeekId} label="Next week focus">
                      <Textarea
                        id={nextWeekId}
                        value={a.nextWeekFocus}
                        onChange={(e) => patchAchievement(a.key, { nextWeekFocus: e.target.value })}
                        aria-label={`Achievement ${n} next week focus for ${customer.name}`}
                        className="min-h-16"
                      />
                    </SyncField>
                    <SyncField
                      id={decisionId}
                      label="Need manager decision"
                      helper="Leave empty if no decision is needed. A filled row pins the customer to the top of Monday's table."
                    >
                      <Textarea
                        id={decisionId}
                        value={a.managerDecision}
                        onChange={(e) => patchAchievement(a.key, { managerDecision: e.target.value })}
                        aria-label={`Achievement ${n} need manager decision for ${customer.name}`}
                        className="min-h-16"
                      />
                    </SyncField>
                  </div>
                </div>
              );
            })}

            <div className="flex flex-col items-start gap-1">
              <button
                type="button"
                onClick={addAchievement}
                disabled={state.achievements.length >= MAX_ACHIEVEMENTS}
                className="flex items-center gap-1.5 rounded-sm border border-outline-variant px-2.5 py-1.5 text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                  add
                </span>
                Add achievement
              </button>
              {state.achievements.length >= MAX_ACHIEVEMENTS && (
                <p className="text-[11px] text-on-surface-variant">20 achievements max.</p>
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
          title="Draft from this week"
          body="Replace the achievements with a draft from this week?"
          confirmLabel="Draft"
          confirmTone="warning"
        />

        <ConfirmModal
          open={confirmReopen}
          onClose={() => setConfirmReopen(false)}
          onConfirm={() => {
            setConfirmReopen(false);
            submit("DRAFT");
          }}
          title="Reopen as draft"
          body="Reopen this week's reflection as a draft?"
          confirmLabel="Reopen"
          confirmTone="warning"
        />
      </>
    </Modal>
  );
}
