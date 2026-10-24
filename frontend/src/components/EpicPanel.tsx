import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePanelFocus } from "@/hooks/usePanelFocus";
import { useSearchParams } from "react-router-dom";
import { InlineDateRangeEditor } from "./InlineDateRangeEditor";
import { TaskStatusChip } from "./StatusChip";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { fmtRange } from "@/lib/formatDate";
import { TASK_STATUS_LABEL } from "@/lib/labels";
import {
  type TaskStatus,
  type UpdateEpicInput,
  useCreateTask,
  useEpic,
  useUpdateEpic,
  useUsers,
} from "@/lib/queries";

const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

interface EpicPanelProps {
  projectId: number;
  epicId: number;
  onClose: () => void;
}

/**
 * Epic detail side panel (docs/archive/plans/epics-spec.md §6), deep-linked via
 * `?epic=<id>` from ProjectEpics.tsx — mirrors TaskPanel.tsx's shell,
 * fixed-right positioning, and Escape-to-close convention (a document
 * keydown listener; no dedicated focus-trap library is used here either,
 * matching TaskPanel exactly).
 *
 * A story row's click opens the SAME task deep link TaskPanel itself answers
 * to (`?task=<id>`), set here via `useSearchParams` rather than a callback
 * prop: `ProjectDetail.tsx` already watches that param at the outlet level,
 * unconditionally, from every project tab — so no wiring is needed beyond
 * setting the param. The two panels can end up mounted at the same time
 * (this one stays open behind, since `?epic=` is left untouched); closing
 * the task panel reveals the epic panel again in the same state.
 */
export function EpicPanel({ projectId, epicId, onClose }: EpicPanelProps) {
  const { user } = useAuth();
  const canEdit = hasPermission(user, "project:write");
  const [searchParams, setSearchParams] = useSearchParams();
  // Read from the Escape listener below via a ref, not a `searchParams`
  // effect dependency — this keeps the listener itself attached once per
  // `onClose` identity (matching TaskPanel's identical effect shape) while
  // still always checking the CURRENT `?task=` state at keydown time.
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  // `epicError` (not `error`): this file already has a local `error` state
  // for action/mutation feedback (patch/description/add-story failures,
  // rendered via the Alert further down) — reusing the name here would
  // shadow it.
  const { data: epic, isLoading, isError, error: epicError } = useEpic(epicId);
  const { data: users } = useUsers();
  const updateEpic = useUpdateEpic();
  const createTask = useCreateTask(projectId);

  const [descDraft, setDescDraft] = useState("");
  const [editingDates, setEditingDates] = useState(false);
  const [newStory, setNewStory] = useState("");
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement | null>(null);
  // Focus moves into the panel on open (and when one shell replaces another)
  // and returns to the opener on close.
  usePanelFocus(panelRef, epicId, isError ? "error" : isLoading || !epic ? "loading" : "ready");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // A story click can stack a TaskPanel on top of this one (see the
      // module doc above) — while that's open, the topmost panel owns the
      // Escape key, so a single press closes only it, not both.
      if (searchParamsRef.current.get("task") !== null) return;
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Reset transient UI whenever the panel targets a DIFFERENT epic — mirrors
  // TaskPanel's identical per-id reset effect.
  useEffect(() => {
    setEditingDates(false);
    setNewStory("");
    setError(null);
  }, [epicId]);

  // Seeds the description draft only when a different epic's data finishes
  // loading (`epic?.id`), never on a background refetch of the SAME epic
  // (queries.ts invalidates `epic(id)` on nearly every story mutation for
  // progress-freshness — re-seeding on those would clobber an in-progress,
  // unsaved edit here).
  useEffect(() => {
    if (epic) setDescDraft(epic.description ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epic?.id]);

  function openTask(taskId: number) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("task", String(taskId));
        return next;
      },
      { replace: true },
    );
  }

  function patch(body: UpdateEpicInput) {
    setError(null);
    updateEpic.mutate(
      { id: epicId, ...body },
      {
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : "Update failed.");
        },
      },
    );
  }

  function handleDescriptionBlur() {
    if (!epic) return;
    const next = descDraft.trim() === "" ? null : descDraft;
    if (next === (epic.description ?? null)) return;
    patch({ description: next });
  }

  async function handleAddStory(e: FormEvent) {
    e.preventDefault();
    const title = newStory.trim();
    if (!title) return;
    setError(null);
    try {
      await createTask.mutateAsync({ title, epicId });
      setNewStory("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add story.");
    }
  }

  // Checked BEFORE the loading branch below: `isLoading` stays true only
  // while a fetch is in flight, but a 404 (e.g. `?epic=<deleted id>`, or a
  // stale deep link) settles `isLoading` to false with `epic` still
  // undefined — without this branch, that state fell into the loading
  // branch and showed "Loading epic…" forever.
  if (isError) {
    return (
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Epic details"
        tabIndex={-1}
        className="fixed right-0 top-14 bottom-0 z-40 flex w-full flex-col border-l border-outline-variant bg-surface-container px-5 py-4 outline-hidden md:w-[380px]"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm text-on-surface-variant">Epic not found</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-on-surface-variant hover:bg-surface-container-high"
            aria-label="Close"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
        <Alert variant="destructive" className="mt-4">
          <AlertDescription className="text-xs">
            Could not load epic: {(epicError as Error).message}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading || !epic) {
    return (
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Epic details"
        aria-busy="true"
        tabIndex={-1}
        className="fixed right-0 top-14 bottom-0 z-40 flex w-full flex-col border-l border-outline-variant bg-surface-container px-5 py-4 outline-hidden md:w-[380px]"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm text-on-surface-variant">Loading epic…</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-on-surface-variant hover:bg-surface-container-high"
            aria-label="Close"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Epic details"
      tabIndex={-1}
      className="fixed right-0 top-14 bottom-0 z-40 flex w-full flex-col border-l border-outline-variant bg-surface-container shadow-overlay outline-hidden md:w-[380px]"
    >
      <div className="flex items-center gap-2 border-b border-outline-variant px-4 py-3">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: epic.color }}
          aria-hidden="true"
        />
        <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-on-surface" title={epic.title}>
          {epic.title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm p-1 text-on-surface-variant hover:bg-surface-container-high"
          aria-label="Close"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-base">close</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2.5 text-sm">
          <span className="self-center font-display text-label-caps uppercase text-on-surface-variant">
            Status
          </span>
          <select
            value={epic.status}
            disabled={!canEdit}
            aria-label="Epic status"
            onChange={(e) => patch({ status: e.target.value as TaskStatus })}
            className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-1.5 py-1 text-xs text-on-surface focus:border-primary focus:outline-hidden disabled:cursor-default"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </select>

          <span className="self-center font-display text-label-caps uppercase text-on-surface-variant">
            Owner
          </span>
          <select
            value={epic.ownerId ?? ""}
            disabled={!canEdit}
            aria-label="Epic owner"
            onChange={(e) =>
              patch({ ownerId: e.target.value === "" ? null : Number(e.target.value) })
            }
            className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-1.5 py-1 text-xs text-on-surface focus:border-primary focus:outline-hidden disabled:cursor-default"
          >
            <option value="">Unassigned</option>
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>

          <span className="self-center font-display text-label-caps uppercase text-on-surface-variant">
            Dates
          </span>
          <div className="relative">
            {editingDates && canEdit ? (
              <InlineDateRangeEditor
                startISO={epic.startDate}
                endISO={epic.dueDate}
                onSave={(s, e) => {
                  patch({ startDate: s, dueDate: e });
                  setEditingDates(false);
                }}
                onCancel={() => setEditingDates(false)}
              />
            ) : (
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setEditingDates(true)}
                className="rounded-sm px-1 py-0.5 text-left text-on-surface hover:bg-surface-container-high disabled:cursor-default"
              >
                {fmtRange(epic.startDate, epic.dueDate)}
              </button>
            )}
          </div>
        </div>

        <div className="mt-4">
          <label
            htmlFor="epic-description"
            className="mb-1.5 block font-display text-label-caps uppercase text-on-surface-variant"
          >
            Description
          </label>
          <textarea
            id="epic-description"
            value={descDraft}
            disabled={!canEdit}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={handleDescriptionBlur}
            rows={4}
            maxLength={2000}
            placeholder="What does this epic cover?"
            className="w-full resize-none rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-hidden disabled:cursor-default"
          />
        </div>

        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        <div className="mt-4">
          <p className="mb-1.5 font-display text-label-caps uppercase text-on-surface-variant">
            Stories {epic.progress.total > 0 && `${epic.progress.done}/${epic.progress.total}`}
          </p>
          {epic.tasks.length === 0 ? (
            <p className="text-xs text-on-surface-variant">No stories yet.</p>
          ) : (
            <ul className="space-y-1">
              {epic.tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-sm px-1 py-1 text-[13px]">
                  <button
                    type="button"
                    onClick={() => openTask(t.id)}
                    title={t.title}
                    className={[
                      "min-w-0 flex-1 truncate rounded-sm text-left hover:text-primary outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring",
                      t.status === "DONE" ? "text-on-surface-variant line-through" : "text-on-surface",
                    ].join(" ")}
                  >
                    {t.title}
                  </button>
                  <TaskStatusChip status={t.status} />
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <form onSubmit={(e) => void handleAddStory(e)} className="mt-1.5 flex items-center gap-1.5">
              <span aria-hidden="true" className="material-symbols-outlined text-[13px] text-primary">add</span>
              <input
                type="text"
                value={newStory}
                onChange={(e) => setNewStory(e.target.value)}
                placeholder="Add story…"
                maxLength={200}
                aria-label="Add story"
                className="flex-1 border-none bg-transparent text-[13px] text-on-surface outline-hidden placeholder:text-on-surface-variant/60 focus:outline-hidden"
              />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
