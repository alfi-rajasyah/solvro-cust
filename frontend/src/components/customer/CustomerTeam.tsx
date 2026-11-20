import { useId, useState } from "react";
import { AssigneeAvatar } from "@/components/AssigneeAvatar";
import { ConfirmModal } from "@/components/ConfirmModal";
import { SkeletonRegion } from "@/components/skeletons/SkeletonRegion";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/formatDate";
import {
  type CustomerTeamMember,
  useAddCustomerTeamMember,
  useCustomerTeam,
  useRemoveCustomerTeamMember,
  useUsers,
} from "@/lib/queries";

// Team tab of the customer page (docs/archive/plans/customer-team.md). Team
// members get a project member's access on every project of the customer,
// including later ones, without ownership. Everyone who can see the customer
// sees the list; only `canManage` gets add and remove.

const TEAM_ERRORS: Record<string, string> = {
  user_inactive: "That user is inactive and can't be added.",
  already_member: "That person is already on the team.",
  forbidden: "You can't change this customer's team.",
};

export function teamErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  const code = (err.body as { code?: unknown } | null)?.code;
  return (
    (typeof code === "string" ? TEAM_ERRORS[code] : undefined) ?? err.message
  );
}

export function CustomerTeam({ customerId }: { customerId: number }) {
  const { user } = useAuth();
  const { data, isLoading, isError } = useCustomerTeam(customerId);
  const canManage = data?.canManage ?? false;
  const {
    data: users,
    isLoading: usersLoading,
    isError: usersError,
  } = useUsers(canManage);
  const pickerId = useId();
  const add = useAddCustomerTeamMember(customerId, user?.id);
  const remove = useRemoveCustomerTeamMember(customerId, user?.id);
  const [pickedId, setPickedId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  const members = data?.members ?? [];
  const confirming = members.find((m) => m.userId === confirmingId) ?? null;
  const taken = new Set(members.map((m) => m.userId));
  const candidates = (users ?? [])
    .filter((u) => u.active && !taken.has(u.id))
    .sort((a, b) => a.username.localeCompare(b.username));

  async function handleAdd() {
    if (pickedId === "") return;
    setError(null);
    try {
      await add.mutateAsync(Number(pickedId));
      setPickedId("");
    } catch (err) {
      setError(teamErrorMessage(err, "Could not add the person."));
    }
  }

  async function handleRemove(userId: number) {
    setError(null);
    setConfirmingId(null);
    try {
      await remove.mutateAsync(userId);
    } catch (err) {
      setError(teamErrorMessage(err, "Could not remove the person."));
    }
  }

  return (
    <section
      aria-label="Customer team"
      data-testid="customer-team"
      className="max-w-2xl space-y-4 rounded-sm border border-outline-variant bg-surface-container-lowest p-4"
    >
      <p className="text-xs text-on-surface-variant">
        Team members can open and edit every project of this customer, including
        projects added later, but they don't own the customer or its projects.
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <SkeletonRegion
          className="space-y-2"
          data-testid="customer-team-loading"
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </SkeletonRegion>
      )}
      {isError && <p className="text-xs text-error">Couldn't load the team.</p>}

      {data && members.length === 0 && (
        <p
          className="text-xs text-on-surface-variant"
          data-testid="customer-team-empty"
        >
          {canManage
            ? "No one is on this team yet. Add the people who work on this customer."
            : "No one is on this team yet."}
        </p>
      )}

      {members.length > 0 && (
        <ul
          className="divide-y divide-outline-variant/60"
          data-testid="customer-team-list"
        >
          {members.map((m) => (
            <TeamRow
              key={m.userId}
              member={m}
              isYou={m.userId === user?.id}
              onRemove={
                canManage
                  ? {
                      busy: remove.isPending && remove.variables === m.userId,
                      run: () => setConfirmingId(m.userId),
                    }
                  : undefined
              }
            />
          ))}
        </ul>
      )}

      {canManage && (
        <div className="space-y-1">
          <label
            htmlFor={pickerId}
            className="block text-meta font-semibold text-on-surface-variant"
          >
            Person to add
          </label>
          {usersError && (
            <p className="text-xs text-error">
              Couldn't load the list of people.
            </p>
          )}
          <div className="flex items-center gap-2">
            <select
              id={pickerId}
              disabled={usersLoading || usersError}
              value={pickedId}
              onChange={(e) => setPickedId(e.target.value)}
              className="[@media(pointer:coarse)]:min-h-11 min-w-0 flex-1 rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <option value="">
                {usersLoading
                  ? "Loading people…"
                  : usersError
                    ? "People unavailable"
                    : candidates.length === 0
                      ? "Everyone is already on this team"
                      : "Add a person…"}
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
              className="[@media(pointer:coarse)]:min-h-11 shrink-0 rounded-sm bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60 outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {add.isPending ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirming !== null}
        onClose={() => setConfirmingId(null)}
        onConfirm={() => confirming && void handleRemove(confirming.userId)}
        title="Remove from team"
        body={
          confirming?.userId === user?.id
            ? "You will lose the access this team gives you. Your tasks in this customer's projects are unassigned, unless you have access another way."
            : `${confirming?.username ?? "This person"} will lose the access this team gives them. Their tasks in this customer's projects are unassigned, unless they have access another way.`
        }
        confirmLabel="Remove from team"
        confirmTone="danger"
        busy={remove.isPending}
      />
    </section>
  );
}

function TeamRow({
  member,
  isYou,
  onRemove,
}: {
  member: CustomerTeamMember;
  isYou: boolean;
  onRemove?: { busy: boolean; run: () => void };
}) {
  const added = member.addedBy
    ? `Added by ${member.addedBy.username}, ${fmtDateTime(member.addedAt)}`
    : `Added ${fmtDateTime(member.addedAt)}`;
  return (
    <li className="py-2">
      <div className="flex items-center gap-3">
        <AssigneeAvatar
          user={{
            id: member.userId,
            username: member.username,
            email: member.email,
          }}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-on-surface">
            {member.username}
            {isYou && (
              <span className="ml-1.5 text-meta font-normal text-on-surface-variant">
                (you)
              </span>
            )}
            {!member.active && (
              <span className="ml-1.5 rounded-sm bg-surface-container-high px-1.5 py-0.5 text-meta font-normal text-on-surface-variant">
                Inactive
              </span>
            )}
          </p>
          <p className="truncate text-meta text-on-surface-variant">{added}</p>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove.run}
            disabled={onRemove.busy}
            aria-label={`Remove ${member.username}`}
            className="tap-target shrink-0 rounded-sm border border-outline-variant px-3 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container hover:text-error disabled:opacity-50 outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            Remove
          </button>
        )}
      </div>
    </li>
  );
}
