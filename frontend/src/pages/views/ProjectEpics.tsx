import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useProjectContext } from "../ProjectDetail";
import { ConfirmModal } from "@/components/ConfirmModal";
import { EpicPanel } from "@/components/EpicPanel";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { CardGridSkeleton, TableSkeleton } from "@/components/skeletons";
import { TaskStatusChip } from "@/components/StatusChip";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { fmtDay } from "@/lib/formatDate";
import { SECTION_COLOR_PRESETS } from "@/lib/gantt/palette";
import {
  type Epic,
  useCreateEpic,
  useDeleteEpic,
  useProjectEpics,
  useUpdateEpic,
} from "@/lib/queries";

/**
 * Epics tab (docs/archive/plans/epics-spec.md §6/§7 T3): a table of a project's
 * epics — color, title, status, owner, due date, and progress (done/total
 * top-level stories) — with inline create/rename/color-pick and a row click
 * that opens the epic detail panel (EpicPanel.tsx), deep-linked via
 * `?epic=<id>` the same way TaskPanel is deep-linked via `?task=<id>`
 * (ProjectDetail.tsx already watches `?task=` at the outlet level, so
 * opening a story from EpicPanel just adds that param — no changes needed
 * there beyond the tab entry).
 */
export function ProjectEpics() {
  const { project } = useProjectContext();
  const { user } = useAuth();
  const canEdit = hasPermission(user, "project:write");
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: epics, isLoading, isError, error } = useProjectEpics(project.id);
  const createEpic = useCreateEpic(project.id);
  const updateEpic = useUpdateEpic();
  const deleteEpic = useDeleteEpic();

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Epic | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // One rename edit settles exactly once — Enter (form submit) and the
  // input's blur (fired when the row unmounts the input on submit/cancel)
  // can both reach `commitRename` for the same edit; without this guard the
  // second call re-sent an identical PATCH. Reset per edit (in
  // `startRename`/`cancelRename`), not per component — same pattern and
  // rationale as TaskPanel.tsx's `renameSettledRef`.
  const renameSettledRef = useRef(false);

  const epicParam = searchParams.get("epic");
  const parsedEpicId = epicParam ? Number(epicParam) : NaN;
  const openEpicId = Number.isFinite(parsedEpicId) ? parsedEpicId : null;

  function openEpicPanel(id: number) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("epic", String(id));
        return next;
      },
      { replace: true },
    );
  }

  function closeEpicPanel() {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("epic");
        return next;
      },
      { replace: true },
    );
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setActionError(null);
    try {
      await createEpic.mutateAsync({ title });
      setNewTitle("");
      setCreating(false);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not create epic.");
    }
  }

  function startRename(epic: Epic) {
    renameSettledRef.current = false;
    setRenameValue(epic.title);
    setRenamingId(epic.id);
  }

  function cancelRename() {
    renameSettledRef.current = true;
    setRenamingId(null);
  }

  async function commitRename(epic: Epic, e?: FormEvent) {
    e?.preventDefault();
    if (renameSettledRef.current) return;
    renameSettledRef.current = true;
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title || title === epic.title) return;
    setActionError(null);
    try {
      await updateEpic.mutateAsync({ id: epic.id, title });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not rename epic.");
    }
  }

  function handlePickColor(epic: Epic, color: string) {
    if (color === epic.color) return;
    updateEpic.mutate({ id: epic.id, color });
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setActionError(null);
    const id = confirmDelete.id;
    try {
      await deleteEpic.mutateAsync({ id, projectId: project.id });
      setConfirmDelete(null);
      if (openEpicId === id) closeEpicPanel();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not delete epic.");
      setConfirmDelete(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <TableSkeleton
          rows={5}
          columns={5}
          widths={["w-3/4", "w-16", "w-24", "w-16", "w-full"]}
          className="hidden md:block"
        />
        <CardGridSkeleton count={4} gridClassName="grid-cols-1" className="md:hidden" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load epics: {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  const rows = epics ?? [];

  return (
    <div className="flex flex-col gap-3 md:min-h-0 md:flex-1">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-sm font-semibold text-on-surface">Epics</h2>
        {canEdit && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 rounded-sm bg-primary px-3 py-1.5 font-display text-xs font-bold text-on-primary hover:bg-primary-container"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base">add</span>
            Add epic
          </button>
        )}
      </div>

      {creating && (
        <form
          onSubmit={handleCreate}
          className="flex items-center gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest p-3"
        >
          <input
            autoFocus
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Escape") {
                setCreating(false);
                setNewTitle("");
              }
            }}
            placeholder="Epic title"
            maxLength={200}
            aria-label="New epic title"
            className="flex-1 rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1 text-sm text-on-surface focus:border-primary focus:outline-hidden"
          />
          <button
            type="submit"
            disabled={createEpic.isPending || !newTitle.trim()}
            className="rounded-sm bg-primary px-3 py-1.5 font-display text-xs font-bold text-on-primary hover:bg-primary-container disabled:opacity-50"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setNewTitle("");
            }}
            className="font-display text-xs font-semibold text-on-surface-variant hover:text-on-surface"
          >
            Cancel
          </button>
        </form>
      )}

      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
        {rows.length === 0 ? (
          <div className="rounded-sm border border-dashed border-outline-variant bg-surface-container-lowest p-12 text-center text-on-surface-variant">
            <p className="text-sm">
              No epics yet. Group this project&apos;s tasks into larger deliverables.
            </p>
            {canEdit && !creating && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="mt-3 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-1.5 font-display text-xs font-bold text-on-surface hover:bg-surface-container"
              >
                Add the first epic
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto rounded-sm border border-outline-variant bg-surface-container-lowest">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low text-left">
                    <th scope="col" className="px-3 py-2 font-display text-label-caps uppercase text-on-surface-variant">
                      Epic
                    </th>
                    <th scope="col" className="px-3 py-2 font-display text-label-caps uppercase text-on-surface-variant">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-2 font-display text-label-caps uppercase text-on-surface-variant">
                      Owner
                    </th>
                    <th scope="col" className="px-3 py-2 font-display text-label-caps uppercase text-on-surface-variant">
                      Due
                    </th>
                    <th scope="col" className="px-3 py-2 font-display text-label-caps uppercase text-on-surface-variant">
                      Progress
                    </th>
                    {canEdit && (
                      <th scope="col" className="px-3 py-2 text-right font-display text-label-caps uppercase text-on-surface-variant">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((epic) => (
                    <EpicRow
                      key={epic.id}
                      epic={epic}
                      canEdit={canEdit}
                      isRenaming={renamingId === epic.id}
                      renameValue={renameValue}
                      onRenameChange={setRenameValue}
                      onStartRename={() => startRename(epic)}
                      onCommitRename={(e) => void commitRename(epic, e)}
                      onCancelRename={cancelRename}
                      onPickColor={(color) => handlePickColor(epic, color)}
                      onOpen={() => openEpicPanel(epic.id)}
                      onDelete={() => setConfirmDelete(epic)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 md:hidden">
              {rows.map((epic) => (
                <EpicCard
                  key={epic.id}
                  epic={epic}
                  canEdit={canEdit}
                  isRenaming={renamingId === epic.id}
                  renameValue={renameValue}
                  onRenameChange={setRenameValue}
                  onStartRename={() => startRename(epic)}
                  onCommitRename={(e) => void commitRename(epic, e)}
                  onCancelRename={cancelRename}
                  onPickColor={(color) => handlePickColor(epic, color)}
                  onOpen={() => openEpicPanel(epic.id)}
                  onDelete={() => setConfirmDelete(epic)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {openEpicId !== null && (
        <EpicPanel
          key={openEpicId}
          projectId={project.id}
          epicId={openEpicId}
          onClose={closeEpicPanel}
        />
      )}

      <ConfirmModal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => void handleDelete()}
        title="Delete epic"
        body={
          confirmDelete ? (
            <p>
              Delete the epic{" "}
              <span className="font-semibold text-on-surface">&quot;{confirmDelete.title}&quot;</span>?{" "}
              Tasks keep their data and lose the epic link.
            </p>
          ) : null
        }
        confirmLabel="Delete"
        confirmTone="danger"
        busy={deleteEpic.isPending}
      />
    </div>
  );
}

interface RowProps {
  epic: Epic;
  canEdit: boolean;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onStartRename: () => void;
  onCommitRename: (e?: FormEvent) => void;
  onCancelRename: () => void;
  onPickColor: (color: string) => void;
  onOpen: () => void;
  onDelete: () => void;
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-surface-container-high">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span
        data-testid="epic-progress-text"
        className="font-mono text-[12px] text-on-surface-variant"
      >
        {done}/{total}
      </span>
    </div>
  );
}

function ColorDot({
  color,
  canEdit,
  onPick,
}: {
  color: string;
  canEdit: boolean;
  onPick: (color: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <span className="relative flex shrink-0 items-center">
      <button
        type="button"
        disabled={!canEdit}
        onClick={(e) => {
          e.stopPropagation();
          setPicking((v) => !v);
        }}
        className="h-2.5 w-2.5 rounded-full disabled:cursor-default"
        style={{ backgroundColor: color }}
        aria-label="Set epic color"
        title={canEdit ? "Set epic color" : undefined}
      />
      {picking && canEdit && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={(e) => {
              e.stopPropagation();
              setPicking(false);
            }}
            aria-label="Close color picker"
          />
          <div className="absolute left-0 top-4 z-50 flex gap-1 rounded-sm border border-outline-variant bg-surface-container-lowest p-1.5 shadow-overlay">
            {SECTION_COLOR_PRESETS.map((hex) => (
              <button
                key={hex}
                type="button"
                className="h-4 w-4 rounded-full hover:ring-2 hover:ring-primary"
                style={{ backgroundColor: hex }}
                onClick={(e) => {
                  e.stopPropagation();
                  onPick(hex);
                  setPicking(false);
                }}
                aria-label={`Epic color ${hex}`}
              />
            ))}
          </div>
        </>
      )}
    </span>
  );
}

function TitleCell({
  epic,
  canEdit,
  isRenaming,
  renameValue,
  onRenameChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onPickColor,
  onOpen,
}: Omit<RowProps, "onDelete">) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <ColorDot color={epic.color} canEdit={canEdit} onPick={onPickColor} />
      {isRenaming ? (
        <form onSubmit={onCommitRename} className="min-w-0 flex-1">
          <input
            autoFocus
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={() => onCommitRename()}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                onCancelRename();
              }
            }}
            maxLength={200}
            aria-label="Epic title"
            className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-1.5 py-0.5 text-sm font-semibold text-on-surface focus:border-primary focus:outline-hidden"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          title={epic.title}
          className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-on-surface hover:text-primary"
        >
          {epic.title}
        </button>
      )}
      {canEdit && !isRenaming && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStartRename();
          }}
          aria-label={`Rename ${epic.title}`}
          className="material-symbols-outlined shrink-0 rounded-sm p-1 text-[15px] text-on-surface-variant/80 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          edit
        </button>
      )}
    </div>
  );
}

function EpicRow(props: RowProps) {
  const { epic, canEdit, onOpen, onDelete } = props;
  return (
    <tr
      className="cursor-pointer border-b border-outline-variant last:border-b-0 hover:bg-surface-container-low"
      onClick={onOpen}
    >
      <td className="px-3 py-2 align-middle" onClick={(e) => e.stopPropagation()}>
        <TitleCell {...props} />
      </td>
      <td className="px-3 py-2 align-middle">
        <TaskStatusChip status={epic.status} />
      </td>
      <td className="px-3 py-2 align-middle text-on-surface-variant">
        {epic.owner?.username ?? "Unassigned"}
      </td>
      <td className="px-3 py-2 align-middle text-[12px] text-on-surface-variant">
        {fmtDay(epic.dueDate) || "—"}
      </td>
      <td className="px-3 py-2 align-middle">
        <ProgressBar done={epic.progress.done} total={epic.progress.total} />
      </td>
      {canEdit && (
        <td className="px-3 py-2 align-middle text-right" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${epic.title}`}
            className="material-symbols-outlined rounded-sm p-1 text-[17px] text-on-surface-variant/80 hover:bg-error-container hover:text-error"
          >
            delete
          </button>
        </td>
      )}
    </tr>
  );
}

function EpicCard(props: RowProps) {
  const { epic, canEdit, onOpen, onDelete } = props;
  return (
    <div className="rounded-sm border border-outline-variant bg-surface-container-lowest p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
          <TitleCell {...props} />
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${epic.title}`}
            className="material-symbols-outlined shrink-0 rounded-sm p-1 text-[17px] text-on-surface-variant/80 hover:bg-error-container hover:text-error"
          >
            delete
          </button>
        )}
      </div>
      <button type="button" onClick={onOpen} className="mt-2 block w-full text-left">
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <TaskStatusChip status={epic.status} />
          <span className="text-on-surface-variant">{epic.owner?.username ?? "Unassigned"}</span>
          <span className="text-on-surface-variant">{fmtDay(epic.dueDate) || "—"}</span>
        </div>
        <div className="mt-2">
          <ProgressBar done={epic.progress.done} total={epic.progress.total} />
        </div>
      </button>
    </div>
  );
}
