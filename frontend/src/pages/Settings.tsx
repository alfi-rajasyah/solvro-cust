import { useState, type CSSProperties, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs } from "@/components/Tabs";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { CardGridSkeleton } from "@/components/skeletons";
import { OutlineConnectCard } from "@/components/outline/OutlineConnectCard";
import { ServiceCatalogueManager } from "@/components/services/ServiceCatalogueManager";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { EMPTY_VALUE } from "@/lib/emptyValue";
import { fmtAgo, fmtDateTime } from "@/lib/formatDate";
import {
  useChangeMyPassword,
  useMyItopToken,
  useOutlineConfig,
  useRemoveMyItopToken,
  useSaveMyItopToken,
} from "@/lib/queries";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import { LIGHT_PREVIEW_VARS } from "@/lib/themePreview";

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

  const [searchParams, setSearchParams] = useSearchParams();
  // Outline is offered once the install has an Outline address; the card
  // itself decides the rest. The OAuth return (`/settings?outline=…`) lands on
  // Integrations, and the card strips that parameter right after reading it,
  // so the landing is remembered here instead of read from the URL.
  const outlineConfig = useOutlineConfig();
  const [outlineReturn, setOutlineReturn] = useState(() => searchParams.has("outline"));
  // A personal token is only usable for ticket writes, which need task:write
  // (the PUT route 403s otherwise), and only when an iTop connection is
  // configured at all. Anyone may still remove a token they already have
  // stored (DELETE is open), so the tab stays for them, without the save form.
  const canSaveItop = hasPermission(user, "task:write");
  const itopToken = useMyItopToken();
  // Whether the iTop row renders: when it does not, the Outline row is the
  // first one under the tab strip and drops its top hairline.
  const showItopRow =
    itopToken.isLoading ||
    (!!itopToken.data?.configured && (canSaveItop || !!itopToken.data.set));
  const showIntegrations =
    outlineReturn ||
    outlineConfig.isLoading ||
    !!outlineConfig.data?.baseUrl ||
    showItopRow;
  const canManageCatalogue = hasPermission(user, "project:write");

  if (!user) return null;

  // One section group per tab. The tab lives in the URL (`?tab=`), so a link
  // can land on it and a reload stays put. A tab the viewer cannot use is not
  // offered: Integrations needs a configured iTop connection or an Outline address, the catalogue
  // needs project:write.
  const tabs: { key: SettingsTab; label: string }[] = [
    { key: "account", label: "Account" },
    { key: "appearance", label: "Appearance" },
    ...(showIntegrations ? [{ key: "integrations" as const, label: "Integrations" }] : []),
    ...(canManageCatalogue ? [{ key: "catalogue" as const, label: "Service catalogue" }] : []),
  ];
  const requested = searchParams.get("tab") ?? (outlineReturn ? "integrations" : null);
  const active: SettingsTab = tabs.some((t) => t.key === requested) ? (requested as SettingsTab) : "account";

  return (
    <div className="mx-auto max-w-5xl">
      <header className="pb-4">
        <h1 className="font-display text-h1 text-on-surface">Settings</h1>
        <p className="text-sm text-on-surface-variant">
          Your account, appearance and integrations.
        </p>
      </header>

      <Tabs
        items={tabs}
        active={active}
        onChange={(key) => {
          setOutlineReturn(false);
          setSearchParams(key === "account" ? {} : { tab: key }, { replace: true });
        }}
      />

      {active === "account" && (
        <>
          <SettingsRow
            id="settings-profile"
            title="Profile"
            description="Username, email, and role can only be changed by an Admin."
            flush
          >
            <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-on-surface-variant">Username</dt>
              <dd className="truncate text-on-surface">{user.username}</dd>

              <dt className="text-on-surface-variant">Email</dt>
              <dd className="truncate text-on-surface">{user.email}</dd>

              <dt className="text-on-surface-variant">Role</dt>
              <dd>
                <span className="rounded-full bg-surface-container-high px-2 py-0.5 font-display text-label-caps uppercase text-on-surface-variant">
                  {user.role}
                </span>
              </dd>
            </dl>
          </SettingsRow>

          <SettingsRow
            id="settings-password"
            title="Change password"
            description="At least 8 characters, different from the current one."
          >
            {success && (
              <Alert variant="success" className="mb-3">
                <AlertDescription>Password updated.</AlertDescription>
              </Alert>
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
                  className={INPUT_CLASS}
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="New password" required>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    required
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field label="Confirm new password" required>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    required
                    className={INPUT_CLASS}
                  />
                </Field>
              </div>
              <div className="flex justify-end">
                <button type="submit" disabled={change.isPending} className={PRIMARY_BUTTON_CLASS}>
                  {change.isPending ? "Saving…" : "Update password"}
                </button>
              </div>
            </form>
          </SettingsRow>

        </>
      )}

      {active === "appearance" && <ThemeRow />}

      {active === "integrations" && (
        <>
          <ItopTokenSection canSave={canSaveItop} />
          {/* The user's own Outline account, and the outcome of a return from
              Outline's consent screen (`/settings?outline=…`). Renders nothing
              while the install has no Outline address. */}
          <div className={showItopRow ? undefined : "[&>section]:border-t-0"}>
            <OutlineConnectCard />
          </div>
        </>
      )}

      {/* The catalogue is global; its writes need project:write on the server. */}
      {active === "catalogue" && (
        <SettingsRow
          id="settings-catalogue"
          title="Service Catalogue"
          description="Workspace-wide."
          wide
          flush
        >
          <ServiceCatalogueManager />
        </SettingsRow>
      )}
    </div>
  );
}

type SettingsTab = "account" | "appearance" | "integrations" | "catalogue";

const INPUT_CLASS =
  "w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30";
const PRIMARY_BUTTON_CLASS =
  "rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-semibold text-on-primary hover:bg-primary/90 disabled:opacity-60 [@media(pointer:coarse)]:min-h-11";

// One settings section: its name and a one-line explanation on the left, its
// controls on the right, a hairline above. Rows instead of boxed cards, so
// the page reads as one list and uses the width (hierarchy from 1px borders,
// docs/DESIGN.md section 4). Below `md:` the two columns stack. `wide` lets the
// controls take the whole right column (the catalogue table); `flush` drops
// the top hairline for the first row under the tab strip, which already draws one.
function SettingsRow({
  id,
  title,
  description,
  wide,
  flush,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  wide?: boolean;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={`grid grid-cols-1 gap-x-10 gap-y-3 py-6 md:grid-cols-[220px_minmax(0,1fr)] ${
        flush ? "" : "border-t border-outline-variant"
      }`}
    >
      <div>
        <h2 id={id} className="font-display text-label-caps uppercase leading-5 text-on-surface">
          {title}
        </h2>
        {description && <p className="mt-1 text-meta text-on-surface-variant">{description}</p>}
      </div>
      <div className={wide ? "min-w-0" : "min-w-0 max-w-xl"}>{children}</div>
    </section>
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
    return (
      <SettingsRow id="settings-itop" title="iTop" flush>
        <CardGridSkeleton count={1} gridClassName="grid-cols-1" />
      </SettingsRow>
    );
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
    <SettingsRow
      id="settings-itop"
      title="iTop"
      flush
      description="Your personal token lets you act on tickets under your own name. Without one, tickets are read-only for you; the application token never writes."
    >
      {token.unreadable ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>
            Your stored token can no longer be read. Enter it again.
          </AlertDescription>
        </Alert>
      ) : (
        token.set && (
          <p className="mb-3 flex items-center gap-1 text-sm text-on-surface">
            <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-chip-emerald-text">
              check_circle
            </span>
            Valid · {token.personName ?? EMPTY_VALUE}
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
                className={INPUT_CLASS}
              />
            </Field>
            <p className="text-meta text-on-surface-variant">
              Create it in iTop under My Account › Personal tokens.
            </p>
          </>
        ) : (
          <p className="text-meta text-on-surface-variant">
            Your role can no longer write to iTop, so this token is unused. You can remove it.
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          {token.set &&
            (confirmingRemove ? (
              <span className="flex items-center gap-2 text-meta text-on-surface-variant">
                Remove your token?
                <button
                  type="button"
                  onClick={() => void handleRemove()}
                  disabled={remove.isPending}
                  className="[@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:items-center font-display text-meta font-bold text-error underline disabled:opacity-50 [@media(pointer:coarse)]:min-h-11"
                >
                  {remove.isPending ? "Removing…" : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingRemove(false)}
                  className="[@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:items-center font-display text-meta font-bold text-on-surface-variant underline [@media(pointer:coarse)]:min-h-11"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                className="rounded-sm border border-outline-variant px-4 py-1.5 font-display text-xs font-semibold text-on-surface-variant hover:bg-surface-container [@media(pointer:coarse)]:min-h-11"
              >
                Remove
              </button>
            ))}
          {canSave && (
            <button
              type="submit"
              disabled={save.isPending || !draft.trim()}
              className={PRIMARY_BUTTON_CLASS}
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </form>
    </SettingsRow>
  );
}

// A miniature of the app shell drawn from the real tokens. The light tile
// re-declares the :root values (there is no `.light` scope to nest in a dark
// page, see lib/themePreview.ts); the dark tile nests the real `.dark` scope.
function ThemeSwatch({ scheme }: { scheme: "light" | "dark" }) {
  return (
    <span
      className={`flex h-full bg-background ${scheme === "dark" ? "dark" : ""}`}
      style={scheme === "light" ? (LIGHT_PREVIEW_VARS as CSSProperties) : undefined}
    >
      <span className="block w-1/4 bg-sidebar" />
      <span className="flex flex-1 flex-col gap-1 p-1">
        <span className="block h-1 w-1/2 rounded-sm bg-primary" />
        <span className="block flex-1 rounded-sm border border-outline-variant bg-surface-container-lowest" />
      </span>
    </span>
  );
}

function ThemeRow() {
  const { choice, resolved, setChoice } = useTheme();
  const options: { key: ThemeChoice; label: string; hint: string }[] = [
    { key: "light", label: "Light", hint: "Always light" },
    { key: "dark", label: "Dark", hint: "Always dark" },
    { key: "system", label: "System", hint: "Follows your device" },
  ];
  return (
    <SettingsRow
      id="settings-appearance"
      title="Appearance"
      flush
      description={
        <>
          Currently rendering in <strong className="text-on-surface">{resolved}</strong> mode.
        </>
      }
    >
      <div role="radiogroup" aria-labelledby="settings-appearance" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {options.map((opt) => {
          const active = choice === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setChoice(opt.key)}
              className={[
                "flex items-center gap-3 rounded-sm border p-2 text-left transition-colors focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30",
                active
                  ? "border-primary bg-primary/5"
                  : "border-outline-variant bg-surface-container-lowest hover:border-primary/40",
              ].join(" ")}
            >
              {/* Theme preview tile */}
              <span
                className="block h-9 w-14 shrink-0 overflow-hidden rounded-sm border border-outline-variant"
                aria-hidden="true"
              >
                {opt.key === "light" && <ThemeSwatch scheme="light" />}
                {opt.key === "dark" && <ThemeSwatch scheme="dark" />}
                {opt.key === "system" && (
                  <span className="grid h-full grid-cols-2">
                    <ThemeSwatch scheme="light" />
                    <ThemeSwatch scheme="dark" />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-on-surface">{opt.label}</span>
                <span className="block truncate text-meta text-on-surface-variant">{opt.hint}</span>
              </span>
              {active && (
                <span aria-hidden="true" className="material-symbols-outlined text-base text-primary">
                  check_circle
                </span>
              )}
            </button>
          );
        })}
      </div>
    </SettingsRow>
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
      <span className="mb-1.5 block text-label-caps uppercase text-on-surface-variant">
        {label}
        {required && <span className="ml-1 text-error">*</span>}
      </span>
      {children}
    </label>
  );
}
