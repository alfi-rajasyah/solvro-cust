// Admin › Outline › "API access": the OAuth app the admin registered in Outline
// (Settings › Applications). Solvro stores the client id and an encrypted,
// write-only client secret - never an Outline API key or admin token; each user
// then connects their own account (docs/archive/plans/outline-integration.md, D2).
import { useEffect, useState, type FormEvent } from "react";
import { CopyField } from "@/components/admin/CopyField";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Chip } from "@/components/StatusChip";
import { ApiError } from "@/lib/api";
import { useUpdateOutlineAdminSettings, type OutlineAdminSettings } from "@/lib/queries";

export const DISCONNECT_WARNING = "Changing the address or client disconnects every user.";

const INPUT =
  "w-full rounded-sm border border-outline-variant bg-surface px-2 py-1.5 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";
const LABEL = "mb-1 block font-display text-label-caps uppercase text-on-surface-variant";

export function OutlineApiCard({ settings }: { settings: OutlineAdminSettings }) {
  const update = useUpdateOutlineAdminSettings();
  const [clientId, setClientId] = useState(settings.oauthClientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Follow the saved value (e.g. after a save elsewhere), but never clobber typing.
  useEffect(() => {
    setClientId(settings.oauthClientId ?? "");
  }, [settings.oauthClientId]);

  const savedId = settings.oauthClientId ?? "";
  const idChanged = clientId.trim() !== savedId;
  const secretEntered = clientSecret.trim() !== "";
  const dirty = idChanged || secretEntered;
  // Re-pointing at a different OAuth client disconnects everyone who connected through the old one.
  const needsConfirm = idChanged && savedId !== "";

  const ready =
    Boolean(settings.baseUrl) &&
    Boolean(settings.oauthClientId) &&
    settings.oauthClientSecretSet &&
    settings.appUrlConfigured;

  async function save() {
    setError(null);
    setSaved(false);
    try {
      await update.mutateAsync({
        ...(idChanged ? { oauthClientId: clientId.trim() === "" ? null : clientId.trim() } : {}),
        ...(secretEntered ? { oauthClientSecret: clientSecret.trim() } : {}),
      });
      setClientSecret("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the API access settings.");
    } finally {
      setConfirmOpen(false);
      // The mutation keeps its variables (the client secret) until reset.
      update.reset();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    if (needsConfirm) setConfirmOpen(true);
    else void save();
  }

  return (
    <section
      aria-label="API access"
      data-testid="outline-api-card"
      className="space-y-4 rounded-sm border border-outline-variant bg-surface-container-lowest p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-sm font-semibold text-on-surface">API access (OAuth app)</h3>
        <Chip tone={ready ? "emerald" : "amber"}>{ready ? "Ready" : "Setup incomplete"}</Chip>
      </div>

      <p className="text-sm text-on-surface-variant">
        In Outline, create an application under Settings › Applications with the redirect URL
        below. Solvro asks for the <code className="font-mono text-meta">read</code> and{" "}
        <code className="font-mono text-meta">create</code> scopes only. Each user then connects
        their own account in Settings; Solvro stores no Outline API key or admin token.
      </p>

      {!settings.appUrlConfigured && (
        <Alert variant="warning" data-testid="outline-app-url-unset">
          <AlertDescription>
            <p>
              The server has no <code className="font-mono text-meta">APP_URL</code> set, so there
              is no redirect URL yet. Set it to the public Solvro address (for example
              https://solvro.example.com) and restart the backend.
            </p>
          </AlertDescription>
        </Alert>
      )}
      {settings.appUrlWarning && (
        <Alert variant="warning" data-testid="outline-app-url-warning">
          <AlertDescription>
            <p>{settings.appUrlWarning}</p>
          </AlertDescription>
        </Alert>
      )}

      {settings.redirectUri && (
        <div>
          <div className={LABEL}>Redirect URL (paste in Outline)</div>
          <CopyField value={settings.redirectUri} label="redirect URL" testId="outline-redirect-uri" />
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-3">
        {error && (
          <div role="alert" className="rounded-sm border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
            {error}
          </div>
        )}
        {saved && !error && (
          <p role="status" className="text-sm text-chip-emerald-text" data-testid="outline-api-saved">
            Saved.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="outline-client-id" className={LABEL}>
              Client ID
            </label>
            <input
              id="outline-client-id"
              name="oauthClientId"
              value={clientId}
              onChange={(e) => {
                setSaved(false);
                setClientId(e.target.value);
              }}
              spellCheck={false}
              autoComplete="off"
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="outline-client-secret" className={LABEL}>
              Client secret{" "}
              <span
                className="font-sans normal-case tracking-normal text-on-surface-variant"
                data-testid="outline-secret-state"
              >
                {settings.oauthClientSecretSet ? "· set" : "· not set"}
              </span>
            </label>
            <input
              id="outline-client-secret"
              name="oauthClientSecret"
              type="password"
              value={clientSecret}
              onChange={(e) => {
                setSaved(false);
                setClientSecret(e.target.value);
              }}
              placeholder={settings.oauthClientSecretSet ? "•••••••• (leave empty to keep)" : "Paste the client secret"}
              spellCheck={false}
              autoComplete="new-password"
              className={INPUT}
            />
          </div>
        </div>
        <p className="text-xs text-on-surface-variant">
          The secret is stored encrypted and never shown again. {DISCONNECT_WARNING}
        </p>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!dirty || update.isPending}
            className="rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-semibold text-on-primary hover:bg-primary-container disabled:opacity-50"
          >
            {update.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void save()}
        title="Change the OAuth client?"
        body="Changing the OAuth client disconnects every user's Outline account. They will have to connect again in Settings."
        confirmLabel="Change client"
        confirmTone="danger"
        busy={update.isPending}
      />
    </section>
  );
}
