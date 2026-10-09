import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { CardGridSkeleton } from "@/components/skeletons";
import { ServiceCatalogueManager } from "@/components/services/ServiceCatalogueManager";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { fmtAgo, fmtDateTime } from "@/lib/formatDate";
import {
  useChangeMyPassword,
  useMyItopToken,
  useRemoveMyItopToken,
  useSaveMyItopToken,
} from "@/lib/queries";
import { useTheme, type ThemeChoice } from "@/lib/theme";

export function Settings() {
  const { user, replaceToken } = useAuth();
  const change = useChangeMyPassword();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (currentPassword === newPassword) {
      setError("New password must differ from the current one.");
      return;
    }
    try {
      const { token } = await change.mutateAsync({ currentPassword, newPassword });
      // The change revoked every session of this account; the server issued
      // a replacement for this one.
      replaceToken(token);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change password.");
    }
  }

  if (!user) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-on-surface">Settings</h1>
        <p className="text-sm text-on-surface-variant">
          Manage your account profile and password.
        </p>
      </header>

      <ThemeCard />

      <section className="rounded-sm border border-outline-variant bg-surface-container-lowest p-5">
        <h2 className="mb-3 font-display text-[13px] font-bold uppercase tracking-wider text-on-surface">
          Profile
        </h2>
        <dl className="grid grid-cols-1 gap-y-2 text-sm md:grid-cols-[140px_1fr]">
          <dt className="text-on-surface-variant">Username</dt>
          <dd className="text-on-surface">{user.username}</dd>

          <dt className="text-on-surface-variant">Email</dt>
          <dd className="text-on-surface">{user.email}</dd>

          <dt className="text-on-surface-variant">Role</dt>
          <dd>
            <span className="rounded-full bg-surface-container-low px-2 py-0.5 font-display text-label-caps uppercase text-on-surface-variant">
              {user.role}
            </span>
          </dd>
        </dl>
        <p className="mt-3 text-[12px] text-on-surface-variant">
          Username, email, and role can only be changed by an Admin.
        </p>
      </section>

      {/* A personal token is only usable for ticket writes, so saving one needs
          task:write (PUT 403s otherwise). Anyone may still remove a token they
          already have stored — DELETE is open — so the section stays for them,
          without the save form. */}
      <ItopTokenSection canSave={hasPermission(user, "task:write")} />

      {hasPermission(user, "project:write") && (
        <section className="rounded-sm border border-outline-variant bg-surface-container-lowest p-5">
          <h2 className="mb-3 font-display text-[13px] font-bold uppercase tracking-wider text-on-surface">
            Service Catalogue
          </h2>
          <ServiceCatalogueManager />
        </section>
      )}

      <section className="rounded-sm border border-outline-variant bg-surface-container-lowest p-5">
        <h2 className="mb-3 font-display text-[13px] font-bold uppercase tracking-wider text-on-surface">
          Change password
        </h2>

        {success && (
          <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Password updated.
          </div>
        )}
        {error && (
          <Alert variant="destructive" className="mb-3">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Current password" required>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
            />
          </Field>
          <Field label="New password" required>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
            />
            <p className="mt-1 text-[12px] text-on-surface-variant">
              At least 8 characters. Must differ from the current password.
            </p>
          </Field>
          <Field label="Confirm new password" required>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
            />
          </Field>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={change.isPending}
              className="rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-semibold text-on-primary hover:bg-primary-container disabled:opacity-60"
            >
              {change.isPending ? "Saving…" : "Update password"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

// "iTop" section (Task 5.2, docs/archive/plans/itop-integration.md): each
// TAM pastes their own personal token (scope REST/JSON) so ticket actions
// (Task 5.3/5.4) are written under their own name, never the shared
// application token. Rendered only when GET /itop/me/token reports
// `configured` — an install with no iTop connection at all never sees this
// section, per the dispatch contract. Same password-input + Save/Remove
// shape as the "Change password" section below.
function ItopTokenSection({ canSave }: { canSave: boolean }) {
  const { data: token, isLoading } = useMyItopToken();
  const save = useSaveMyItopToken();
  const remove = useRemoveMyItopToken();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  if (isLoading) {
    return <CardGridSkeleton count={1} gridClassName="grid-cols-1" />;
  }
  if (!token || !token.configured) return null;
  // Without task:write there is nothing to save; the section only offers
  // removing a token that is still stored.
  if (!canSave && !token.set) return null;

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = draft.trim();
    if (!trimmed) return;
    try {
      await save.mutateAsync({ token: trimmed });
      setDraft("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the token.");
    }
  }

  async function handleRemove() {
    setError(null);
    try {
      await remove.mutateAsync();
      setConfirmingRemove(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove the token.");
      setConfirmingRemove(false);
    }
  }

  return (
    <section className="rounded-sm border border-outline-variant bg-surface-container-lowest p-5">
      <h2 className="mb-3 font-display text-[13px] font-bold uppercase tracking-wider text-on-surface">
        iTop
      </h2>

      {token.unreadable ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>
            Your stored token can no longer be read — enter it again.
          </AlertDescription>
        </Alert>
      ) : (
        token.set && (
          <p className="mb-3 flex items-center gap-1 text-sm text-on-surface">
            <span className="material-symbols-outlined text-[16px] text-chip-emerald-text">
              check_circle
            </span>
            Valid · {token.personName ?? "—"}
            {token.checkedAt && ` · checked ${fmtAgo(token.checkedAt)}`}
            {token.expiresAt && ` · expires ${fmtDateTime(token.expiresAt)}`}
          </p>
        )
      )}

      {error && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSave} className="space-y-3">
        {canSave ? (
          <>
            <Field label="My personal token">
              <input
                type="password"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={token.set ? "•••••••• (set)" : "scope REST/JSON"}
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
              />
            </Field>
            <p className="text-[12px] text-on-surface-variant">
              Create it in iTop under My Account › Personal tokens. Without a token, tickets are
              read-only for you; the application token never writes.
            </p>
          </>
        ) : (
          <p className="text-[12px] text-on-surface-variant">
            Your role can no longer write to iTop, so this token is unused. You can remove it.
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          {token.set &&
            (confirmingRemove ? (
              <span className="flex items-center gap-2 text-[12px] text-on-surface-variant">
                Remove your token?
                <button
                  type="button"
                  onClick={() => void handleRemove()}
                  disabled={remove.isPending}
                  className="font-display text-[12px] font-bold text-error underline disabled:opacity-50"
                >
                  {remove.isPending ? "Removing…" : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingRemove(false)}
                  className="font-display text-[12px] font-bold text-on-surface-variant underline"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                className="rounded-sm border border-outline-variant px-4 py-1.5 font-display text-xs font-semibold text-on-surface-variant hover:bg-surface-container"
              >
                Remove
              </button>
            ))}
          {canSave && (
            <button
              type="submit"
              disabled={save.isPending || !draft.trim()}
              className="rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-semibold text-on-primary hover:bg-primary-container disabled:opacity-60"
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function ThemeCard() {
  const { choice, resolved, setChoice } = useTheme();
  const options: { key: ThemeChoice; label: string; icon: string; hint: string }[] = [
    { key: "light", label: "Light", icon: "light_mode", hint: "Always light" },
    { key: "dark", label: "Dark", icon: "dark_mode", hint: "Always dark" },
    {
      key: "system",
      label: "System",
      icon: "computer",
      hint: "Follow OS preference",
    },
  ];
  return (
    <section className="rounded-sm border border-outline-variant bg-surface-container-lowest p-5">
      <h2 className="mb-1 font-display text-[13px] font-bold uppercase tracking-wider text-on-surface">
        Appearance
      </h2>
      <p className="mb-3 text-[12px] text-on-surface-variant">
        Currently rendering in <strong className="text-on-surface">{resolved}</strong> mode.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {options.map((opt) => {
          const active = choice === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setChoice(opt.key)}
              className={[
                "flex flex-col gap-2 rounded-sm border p-3 text-left transition-colors",
                active
                  ? "border-primary bg-primary/5"
                  : "border-outline-variant bg-surface-container-lowest hover:border-primary/40",
              ].join(" ")}
            >
              <div className="flex items-center justify-between">
                <span className="font-display text-[12px] font-bold uppercase tracking-wider text-on-surface">
                  {opt.label}
                </span>
                {active ? (
                  <span className="material-symbols-outlined text-base text-primary">check_circle</span>
                ) : (
                  <span className={`material-symbols-outlined text-base text-on-surface-variant`}>{opt.icon}</span>
                )}
              </div>
              {/* Theme preview tile */}
              <div
                className="h-12 rounded-sm border border-outline-variant overflow-hidden"
                aria-hidden
              >
                {opt.key === "light" && (
                  <div className="h-full bg-white" style={{ borderColor: "#D1D6E2" }} />
                )}
                {opt.key === "dark" && (
                  <div className="h-full" style={{ background: "#0F1623" }} />
                )}
                {opt.key === "system" && (
                  <div className="grid h-full grid-cols-2">
                    <div className="bg-white" />
                    <div style={{ background: "#0F1623" }} />
                  </div>
                )}
              </div>
              <p className="text-xs text-on-surface-variant">{opt.hint}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">
        {label}
        {required && <span className="ml-1 text-error">*</span>}
      </span>
      {children}
    </label>
  );
}
