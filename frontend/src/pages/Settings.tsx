import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { ServiceCatalogueManager } from "@/components/services/ServiceCatalogueManager";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { useChangeMyPassword } from "@/lib/queries";
import { useTheme, type ThemeChoice } from "@/lib/theme";

export function Settings() {
  const { user } = useAuth();
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
      await change.mutateAsync({ currentPassword, newPassword });
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
          <dd className="font-mono text-on-surface">{user.username}</dd>

          <dt className="text-on-surface-variant">Email</dt>
          <dd className="font-mono text-on-surface">{user.email}</dd>

          <dt className="text-on-surface-variant">Role</dt>
          <dd>
            <span className="rounded-full bg-surface-container-low px-2 py-0.5 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
              {user.role}
            </span>
          </dd>
        </dl>
        <p className="mt-3 text-[12px] text-on-surface-variant">
          Username, email, and role can only be changed by an Admin.
        </p>
      </section>

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
              className="rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-bold uppercase tracking-wider text-on-primary hover:bg-primary-container disabled:opacity-60"
            >
              {change.isPending ? "Saving…" : "Update password"}
            </button>
          </div>
        </form>
      </section>
    </div>
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
              <p className="text-[11px] text-on-surface-variant">{opt.hint}</p>
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
