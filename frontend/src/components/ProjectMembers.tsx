import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AssigneeAvatar } from "@/components/AssigneeAvatar";
import { Modal } from "@/components/Modal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canOwnProject } from "@/lib/ownerAccess";
import { memberCandidates, removalWarning, splitMemberOverflow } from "@/lib/projectMembers";
import {
  type ProjectDetail,
  useAddProjectMember,
  useProjectMembers,
  useRemoveProjectMember,
  useUsers,
} from "@/lib/queries";

// Header control: the TAM plus member avatars ("+N" past the cap) that opens
// the Members dialog (docs/archive/plans/collaboration-and-sharing.md, C1).
// Members have the same access as the TAM. Everyone who can open the project
// sees the list; only `canManage` (project:write) gets add / remove.

const MAX_AVATARS = 3;

export function ProjectMembersButton({
  project,
  canManage,
}: {
  project: ProjectDetail;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { data: members } = useProjectMembers(project.id);
  const { visible, overflow } = splitMemberOverflow(members ?? [], MAX_AVATARS);
  const count = (members?.length ?? 0) + 1;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Project members (${count})`}
        title="Project members"
        data-testid="project-members-button"
        className="flex h-8 items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-2 outline-hidden transition-colors hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <span className="flex items-center gap-0.5" data-testid="project-member-avatars">
          {/* TAM first. Side by side, not overlapped: two initials need the full disc. */}
          <span className="rounded-full ring-2 ring-surface-container-lowest">
            <AssigneeAvatar user={project.tam} size="sm" />
          </span>
          {visible.map((m) => (
            <span key={m.userId} className="rounded-full ring-2 ring-surface-container-lowest">
              <AssigneeAvatar
                user={{
                  id: m.userId,
                  username: m.username,
                  email: m.email,
                  avatarUrl: m.avatarUrl,
                }}
                size="sm"
              />
            </span>
          ))}
        </span>
        {overflow > 0 && (
          <span className="text-meta font-semibold tabular-nums text-on-surface-variant">
            +{overflow}
          </span>
        )}
        <span className="material-symbols-outlined text-base text-on-surface-variant" aria-hidden="true">
          {canManage ? "group_add" : "group"}
        </span>
      </button>
      <ProjectMembersDialog
        project={project}
        canManage={canManage}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function ProjectMembersDialog({
  project,
  canManage,
  open,
  onClose,
}: {
  project: ProjectDetail;
  canManage: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: members, isLoading, isError } = useProjectMembers(open ? project.id : null);
  const { data: users } = useUsers();
  const add = useAddProjectMember(project.id);
  const remove = useRemoveProjectMember(project.id);
  const [pickedId, setPickedId] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Member whose removal is awaiting the in-dialog confirmation (they have
  // assigned tasks that removal would unassign).
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  const candidates = memberCandidates(users, project.tam.id, members ?? []);

  function close() {
    setError(null);
    setConfirmingId(null);
    setPickedId("");
    onClose();
  }

  async function handleAdd() {
    if (pickedId === "") return;
    setError(null);
    try {
      await add.mutateAsync(Number(pickedId));
      setPickedId("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the member.");
    }
  }

  async function handleRemove(userId: number) {
    setError(null);
    setConfirmingId(null);
    try {
      await remove.mutateAsync(userId);
      // Only when they actually lost access: the TAM, a customer owner or a
      // view-all user keeps it, and stays on the page.
      if (userId === user?.id && !canOwnProject(user, project, project.customer?.tamId)) {
        onClose();
        navigate("/projects", { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove the member.");
    }
  }

  return (
    <Modal open={open} onClose={close} title="Project members">
      <div className="space-y-4">
        <p className="text-xs text-on-surface-variant">
          Members can view and edit everything in this project, like its TAM.
        </p>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <ul className="divide-y divide-outline-variant/60" data-testid="project-members-list">
          <MemberRow
            person={project.tam}
            badge="TAM"
            isYou={project.tam.id === user?.id}
          />
          {isLoading && (
            <li className="py-2 text-xs text-on-surface-variant">Loading members…</li>
          )}
          {isError && (
            <li className="py-2 text-xs text-error">Couldn't load the member list.</li>
          )}
          {(members ?? []).map((m) => (
            <MemberRow
              key={m.userId}
              person={{
                id: m.userId,
                username: m.username,
                email: m.email,
                avatarUrl: m.avatarUrl,
              }}
              detail={m.addedBy ? `Added by ${m.addedBy.username}` : undefined}
              isYou={m.userId === user?.id}
              onRemove={
                canManage
                  ? {
                      busy: remove.isPending && remove.variables === m.userId,
                      // Members with assigned tasks get a confirmation first.
                      run: () =>
                        m.assignedTaskCount > 0
                          ? setConfirmingId(m.userId)
                          : void handleRemove(m.userId),
                    }
                  : undefined
              }
              confirm={
                confirmingId === m.userId
                  ? {
                      message: removalWarning(m.assignedTaskCount),
                      onCancel: () => setConfirmingId(null),
                      onConfirm: () => void handleRemove(m.userId),
                    }
                  : undefined
              }
            />
          ))}
        </ul>

        {canManage && (
          <div className="flex items-center gap-2">
            <select
              aria-label="Person to add"
              value={pickedId}
              onChange={(e) => setPickedId(e.target.value)}
              className="min-w-0 flex-1 rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <option value="">
                {candidates.length === 0 ? "Everyone is already on this project" : "Add a person…"}
              </option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username} · {u.email}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={pickedId === "" || add.isPending}
              className="shrink-0 rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60 outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              {add.isPending ? "Adding…" : "Add"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function MemberRow({
  person,
  badge,
  detail,
  isYou,
  onRemove,
  confirm,
}: {
  person: { id: number; username: string; email: string; avatarUrl?: string | null };
  badge?: string;
  detail?: string;
  isYou: boolean;
  onRemove?: { busy: boolean; run: () => void };
  confirm?: { message: string; onCancel: () => void; onConfirm: () => void };
}) {
  return (
    <li className="py-2">
      <div className="flex items-center gap-3">
      <AssigneeAvatar user={person} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-on-surface">
          {person.username}
          {isYou && <span className="ml-1.5 text-meta font-normal text-on-surface-variant">(you)</span>}
        </p>
        <p className="truncate text-meta text-on-surface-variant">
          {person.email}
          {detail ? ` · ${detail}` : ""}
        </p>
      </div>
      {badge && (
        <span className="rounded-sm bg-surface-container-high px-1.5 py-0.5 font-display text-label-caps uppercase text-on-surface-variant">
          {badge}
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove.run}
          disabled={onRemove.busy}
          aria-label={`Remove ${person.username}`}
          className="shrink-0 rounded-lg border border-outline-variant px-3 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container hover:text-error disabled:opacity-50 outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          Remove
        </button>
      )}
      </div>
      {confirm && (
        <div
          data-testid="member-remove-confirm"
          className="mt-2 flex flex-wrap items-center gap-2 rounded-sm bg-surface-container-low px-3 py-2"
        >
          <p className="min-w-0 flex-1 text-xs text-on-surface">{confirm.message}</p>
          <button
            type="button"
            onClick={confirm.onCancel}
            className="rounded-lg border border-outline-variant px-3 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm.onConfirm}
            className="rounded-lg bg-error px-3 py-1 text-xs font-bold text-on-error hover:bg-error/90 outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            Remove and unassign
          </button>
        </div>
      )}
    </li>
  );
}
