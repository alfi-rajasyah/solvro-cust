// Admin "iTop" tab (Task 1.6): Connection settings + Test connection,
// Customers → iTop organisations mapping, Users → iTop persons match
// report. Backend: backend/src/routes/itopAdmin.ts, mounted at /admin/itop
// (docs/archive/plans/itop-integration.md §2 deviation 4 — a dedicated
// router, not routes/admin.ts). Mirrors the in-file tab-as-function
// convention Admin.tsx already uses for its Users/Roles/Sign-in tabs,
// rather than splitting into separate component files.
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import {
  useAutomatchItopCustomers,
  useGenerateItopWebhookSecret,
  useItopCustomers,
  useItopOrganizations,
  useItopPersons,
  useItopSettings,
  useItopSyncNow,
  useMapItopCustomer,
  useMatchItopPersons,
  useRemoveItopWebhookSecret,
  useTestItopConnection,
  useUpdateItopSettings,
  type ItopCustomerMatch,
  type ItopCustomerRow,
  type ItopProbeResult,
  type ItopReadClass,
  type ItopWebhookSecretResult,
} from "@/lib/queries";
import {
  buildItopSettingsPatch,
  buildItopTestInput,
  clampInt,
  formStateFromSettings,
  type ItopSettingsFormState,
} from "./itopSettingsDiff";
import { Chip } from "@/components/StatusChip";
import { Switch } from "@/components/ui/switch";

const OUTLINE_BUTTON_CLASS =
  "rounded-sm border border-outline-variant px-3 py-1 font-display text-[12px] font-bold uppercase tracking-wider text-on-surface-variant hover:bg-surface-container disabled:opacity-50";

const READ_CLASS_LABEL: Record<ItopReadClass, string> = {
  UserRequest: "User requests",
  Incident: "Incidents",
};

const MATCH_LABEL: Record<ItopCustomerMatch, string> = {
  name: "by name",
  manual: "manual",
  unmatched: "unmatched",
};

const MATCH_TONE: Record<ItopCustomerMatch, "emerald" | "blue" | "amber"> = {
  name: "emerald",
  manual: "blue",
  unmatched: "amber",
};

// Same shape/rationale as TaskPanel.tsx's own local `relativeTime` — no
// shared export exists for this and this is the only other call site.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function ItopTab() {
  return (
    <div className="space-y-4">
      <ConnectionCard />
      <WebhookCard />
      <CustomersCard />
      <PersonsCard />
    </div>
  );
}

// ---- Connection card --------------------------------------------------

function ConnectionCard() {
  const { data: settings, isLoading, isError } = useItopSettings();
  const updateSettings = useUpdateItopSettings();
  const testConnection = useTestItopConnection();
  const syncNow = useItopSyncNow();

  const [form, setForm] = useState<ItopSettingsFormState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Initialize the editable draft once the settings load; re-baselined
  // explicitly after a successful Save (see handleSave) rather than reacting
  // to every settings refetch, so a background sync completing mid-edit
  // never clobbers what the admin is typing.
  useEffect(() => {
    if (settings && form === null) {
      setForm(formStateFromSettings(settings));
    }
  }, [settings, form]);

  if (isLoading || !settings || !form) {
    return (
      <section className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
        <h2 className="font-display text-sm font-semibold text-on-surface">Connection</h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          {isError ? "Failed to load iTop settings." : "Loading…"}
        </p>
      </section>
    );
  }

  const patch = buildItopSettingsPatch(form, settings);
  const dirty = Object.keys(patch).length > 0;
  const testData = testConnection.data;
  const totalProbes = testData?.probes.length ?? 0;
  const passedProbes = testData?.probes.filter((p) => p.ok).length ?? 0;

  const connectionStatus = !settings.baseUrl || !settings.appTokenSet
    ? { label: "Not connected", tone: "gray" as const }
    : testData
      ? testData.ok
        ? { label: `Connected · ${passedProbes}/${totalProbes} checks passed`, tone: "emerald" as const }
        : { label: `${passedProbes}/${totalProbes} checks passed`, tone: "amber" as const }
      : { label: "Configured — run Test connection to verify", tone: "gray" as const };

  async function handleSave() {
    setSaveError(null);
    try {
      const fresh = await updateSettings.mutateAsync(patch);
      setForm(formStateFromSettings(fresh));
    } catch (err) {
      setSaveError(errorMessage(err, "Could not save iTop settings."));
    }
  }

  async function handleTest() {
    if (!form || !settings) return;
    try {
      await testConnection.mutateAsync(buildItopTestInput(form, settings));
    } catch {
      // Surfaced via testConnection.isError/testConnection.error below.
    }
  }

  async function handleSync() {
    setSyncError(null);
    setSyncMessage(null);
    try {
      // POST /admin/itop/sync is fire-and-forget on the backend (202 as soon
      // as it's kicked off, not once it finishes) — useItopSyncNow's own
      // onSuccess schedules the follow-up refetches that pick up the result.
      const result = await syncNow.mutateAsync({ full: true });
      setSyncMessage(
        result.started
          ? "Sync started…"
          : result.reason === "busy"
            ? "A sync is already running."
            : `Not started (${result.reason}).`,
      );
    } catch (err) {
      setSyncError(errorMessage(err, "Sync failed."));
    }
  }

  function toggleReadClass(cls: ItopReadClass) {
    setForm((f) => {
      if (!f) return f;
      const has = f.readClasses.includes(cls);
      if (has && f.readClasses.length === 1) return f; // at least one required
      return {
        ...f,
        readClasses: has
          ? f.readClasses.filter((c) => c !== cls)
          : [...f.readClasses, cls],
      };
    });
  }

  // Clamp/validate on blur: an in-progress edit (a momentarily empty or
  // out-of-range box) is left alone while typing (see ItopSettingsFormState's
  // raw-string rationale in itopSettingsDiff.ts) and only normalized once the
  // admin leaves the field — falling back to the last-saved value when the
  // field can't be parsed at all.
  function handleRefreshMinutesBlur() {
    if (!settings) return;
    const fallback = settings.refreshMinutes;
    setForm((f) => {
      if (!f) return f;
      const clamped = clampInt(f.refreshMinutes, 1, 60);
      return { ...f, refreshMinutes: String(clamped ?? fallback) };
    });
  }

  function handleCapacityBlur() {
    if (!settings) return;
    const fallback = settings.capacityHoursPerWeek;
    setForm((f) => {
      if (!f) return f;
      const clamped = clampInt(f.capacityHoursPerWeek, 1, 80);
      return { ...f, capacityHoursPerWeek: String(clamped ?? fallback) };
    });
  }

  return (
    <section className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
      <h2 className="font-display text-sm font-semibold text-on-surface">Connection</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
            iTop URL
          </span>
          <input
            type="text"
            value={form.baseUrl}
            onChange={(e) => setForm((f) => (f ? { ...f, baseUrl: e.target.value } : f))}
            placeholder="https://itop.example.com"
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-sm border border-outline-variant bg-surface px-2 py-1.5 font-mono text-sm focus:border-primary focus:outline-hidden"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
            Application token
          </span>
          <input
            type="password"
            value={form.appToken}
            onChange={(e) => setForm((f) => (f ? { ...f, appToken: e.target.value } : f))}
            placeholder={settings.appTokenSet ? "•••••••• (set)" : "Auth-Token header"}
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-sm border border-outline-variant bg-surface px-2 py-1.5 font-mono text-sm focus:border-primary focus:outline-hidden"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={[
            "rounded-full px-2 py-0.5 font-display text-[11px] font-semibold",
            connectionStatus.tone === "emerald"
              ? "bg-chip-emerald-bg text-chip-emerald-text"
              : connectionStatus.tone === "amber"
                ? "bg-chip-amber-bg text-chip-amber-text"
                : "bg-surface-container-high text-on-surface-variant",
          ].join(" ")}
        >
          {connectionStatus.label}
        </span>
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={testConnection.isPending}
          className="rounded-sm border border-outline-variant px-3 py-1 font-display text-[12px] font-bold uppercase tracking-wider text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
        >
          {testConnection.isPending ? "Testing…" : "Test connection"}
        </button>
      </div>

      {testConnection.isError && (
        <p className="mt-2 text-sm text-error">
          {errorMessage(testConnection.error, "Test connection failed.")}
        </p>
      )}
      {testData && <ProbeList probes={testData.probes} />}

      <div className="mt-4 grid gap-3 border-t border-outline-variant pt-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
            Refresh every
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={60}
              value={form.refreshMinutes}
              onChange={(e) =>
                setForm((f) => (f ? { ...f, refreshMinutes: e.target.value } : f))
              }
              onBlur={handleRefreshMinutesBlur}
              className="w-24 rounded-sm border border-outline-variant bg-surface px-2 py-1.5 font-mono text-sm focus:border-primary focus:outline-hidden"
            />
            <span className="text-sm text-on-surface-variant">min</span>
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
            Capacity per TAM
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={80}
              value={form.capacityHoursPerWeek}
              onChange={(e) =>
                setForm((f) =>
                  f ? { ...f, capacityHoursPerWeek: e.target.value } : f,
                )
              }
              onBlur={handleCapacityBlur}
              className="w-24 rounded-sm border border-outline-variant bg-surface px-2 py-1.5 font-mono text-sm focus:border-primary focus:outline-hidden"
            />
            <span className="text-sm text-on-surface-variant">h / week</span>
          </div>
        </label>
      </div>

      <div className="mt-3">
        <span className="mb-1 block font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
          Read
        </span>
        <div className="flex flex-wrap gap-4">
          {(Object.keys(READ_CLASS_LABEL) as ItopReadClass[]).map((cls) => (
            <label key={cls} className="flex items-center gap-2 text-sm text-on-surface">
              <input
                type="checkbox"
                checked={form.readClasses.includes(cls)}
                onChange={() => toggleReadClass(cls)}
                className="accent-primary"
              />
              {READ_CLASS_LABEL[cls]}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-start justify-between gap-3 border-t border-outline-variant pt-3">
        <div>
          <span className="block font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
            Actions from Solvro
          </span>
          <p className="mt-0.5 text-xs text-on-surface-variant">
            Each TAM needs a personal token (Settings › iTop). The application token never
            writes.
          </p>
        </div>
        <Switch
          checked={form.actionsEnabled}
          onCheckedChange={(checked) =>
            setForm((f) => (f ? { ...f, actionsEnabled: checked } : f))
          }
          aria-label="Actions from Solvro"
        />
      </div>

      {saveError && <p className="mt-3 text-sm text-error">{saveError}</p>}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || updateSettings.isPending}
          className="rounded-sm bg-primary px-4 py-1.5 font-display text-[12px] font-bold uppercase tracking-wider text-on-primary hover:bg-primary-container disabled:opacity-50"
        >
          {updateSettings.isPending ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant pt-3">
        <p className="text-[13px] text-on-surface-variant">
          {settings.lastSyncAt ? (
            settings.lastSyncOk ? (
              <>Synced {relativeTime(settings.lastSyncAt)} · ok</>
            ) : (
              <span className="text-error">
                Synced {relativeTime(settings.lastSyncAt)} ·{" "}
                {settings.lastSyncError ?? "failed"}
              </span>
            )
          ) : (
            "Never synced"
          )}
        </p>
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={syncNow.isPending || !settings.baseUrl || !settings.appTokenSet}
          className="rounded-sm border border-outline-variant px-3 py-1 font-display text-[12px] font-bold uppercase tracking-wider text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
        >
          {syncNow.isPending ? "Syncing…" : "Sync now"}
        </button>
      </div>
      {syncError && <p className="mt-2 text-sm text-error">{syncError}</p>}
      {syncMessage && (
        <p className="mt-2 text-[12px] text-on-surface-variant">{syncMessage}</p>
      )}
    </section>
  );
}

function ProbeList({ probes }: { probes: ItopProbeResult[] }) {
  return (
    <ul className="mt-2 space-y-1 rounded-sm border border-outline-variant bg-surface p-2">
      {probes.map((p) => (
        <li key={p.name} className="flex items-start gap-2 text-[13px]">
          <span
            aria-hidden="true"
            className={`material-symbols-outlined shrink-0 text-[16px] ${p.ok ? "text-chip-emerald-text" : "text-error"}`}
          >
            {p.ok ? "check_circle" : "cancel"}
          </span>
          <span className="sr-only">{p.ok ? "Passed" : "Failed"}</span>
          <span className="shrink-0 font-medium text-on-surface">{p.name}</span>
          {p.name === "TimeSpent" ? (
            <span
              className="min-w-0 flex-1 truncate font-mono text-[11px] text-on-surface-variant"
              title={p.message}
            >
              {p.message}
            </span>
          ) : (
            <span className="min-w-0 flex-1 text-on-surface-variant">{p.message}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---- Webhook card (Task 4.1) -------------------------------------------
// Optional sync nudge: iTop POSTs to /webhook/itop with a shared secret on
// "ticket update", collapsing the worst-case staleness from a full
// `refreshMinutes` interval down to however long the nudge + resync takes.
// The secret itself is returned exactly once, by POST — this component is
// the only place in the app that ever holds the plaintext value, and only
// for the current mount (kept in local state, never cached by TanStack
// Query, never persisted). `webhookSecretSet` on ItopSettings is the only
// trace that survives a remount or reload.
function WebhookCard() {
  const { data: settings } = useItopSettings();
  const generateSecret = useGenerateItopWebhookSecret();
  const removeSecret = useRemoveItopWebhookSecret();

  const [revealed, setRevealed] = useState<ItopWebhookSecretResult | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  if (!settings) return null;

  async function handleGenerate() {
    setGenError(null);
    try {
      const result = await generateSecret.mutateAsync();
      setRevealed(result);
      setConfirmingRemove(false);
    } catch (err) {
      setGenError(errorMessage(err, "Could not generate a webhook secret."));
    }
  }

  async function handleRemove() {
    setRemoveError(null);
    try {
      await removeSecret.mutateAsync();
      setRevealed(null);
      setConfirmingRemove(false);
    } catch (err) {
      setRemoveError(errorMessage(err, "Could not remove the webhook secret."));
    }
  }

  async function handleCopy(label: string, value: string) {
    try {
      await copyText(value);
      setCopiedLabel(label);
      setTimeout(() => setCopiedLabel((c) => (c === label ? null : c)), 1500);
    } catch {
      // Best-effort only — this app has no toast system to surface a
      // clipboard-permission failure through, and the value stays on screen
      // (selectable/readable) either way.
    }
  }

  // URL/header are static per install (the path and header name never vary
  // — only the secret itself is generated) and worth showing as soon as a
  // secret exists at all, not just in the fresh one-time reveal. `revealed`
  // (right after Generate/Rotate, before the DB round-trip that flips
  // `webhookSecretSet` has settled) still counts as "exists" here too.
  const showWebhookDetails = settings.webhookSecretSet || revealed !== null;
  const webhookUrl = `${window.location.origin}${revealed?.path ?? "/api/webhook/itop"}`;
  const webhookHeader = revealed?.header ?? "X-Solvro-Webhook-Secret";

  return (
    <section className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
      <h2 className="font-display text-sm font-semibold text-on-surface">Webhook (optional)</h2>
      <p className="mt-1 text-[13px] text-on-surface-variant">
        Without it, tickets are at most {settings.refreshMinutes} minutes stale; with it, seconds.
      </p>

      {showWebhookDetails && (
        <div className="mt-3 space-y-3 rounded-sm border border-outline-variant bg-surface p-3">
          <CopyRow label="URL" value={webhookUrl} copiedLabel={copiedLabel} onCopy={handleCopy} />
          <CopyRow
            label="Header"
            value={webhookHeader}
            copiedLabel={copiedLabel}
            onCopy={handleCopy}
          />
          {revealed && (
            <>
              <CopyRow
                label="Secret"
                value={revealed.secret}
                copiedLabel={copiedLabel}
                onCopy={handleCopy}
              />
              <p className="text-[12px] text-on-surface-variant">
                Shown once. In iTop, add a Webhook integration with trigger "on ticket update"
                that POSTs to this URL with this header.
              </p>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setRevealed(null)}
                  className={OUTLINE_BUTTON_CLASS}
                >
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {settings.webhookSecretSet ? (
          <>
            <Chip tone="emerald">Configured</Chip>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generateSecret.isPending}
              className={OUTLINE_BUTTON_CLASS}
            >
              {generateSecret.isPending ? "Rotating…" : "Rotate"}
            </button>
            {confirmingRemove ? (
              <span className="flex items-center gap-2 text-[12px] text-on-surface-variant">
                Remove the webhook secret?
                <button
                  type="button"
                  onClick={() => void handleRemove()}
                  disabled={removeSecret.isPending}
                  className="font-display text-[12px] font-bold text-error underline disabled:opacity-50"
                >
                  {removeSecret.isPending ? "Removing…" : "Confirm"}
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
                className={OUTLINE_BUTTON_CLASS}
              >
                Remove
              </button>
            )}
          </>
        ) : (
          <>
            <Chip tone="gray">Not configured</Chip>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generateSecret.isPending}
              className={OUTLINE_BUTTON_CLASS}
            >
              {generateSecret.isPending ? "Generating…" : "Generate secret"}
            </button>
          </>
        )}
      </div>

      {genError && <p className="mt-2 text-sm text-error">{genError}</p>}
      {removeError && <p className="mt-2 text-sm text-error">{removeError}</p>}
    </section>
  );
}

function CopyRow({
  label,
  value,
  copiedLabel,
  onCopy,
}: {
  label: string;
  value: string;
  copiedLabel: string | null;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <div>
      <span className="mb-1 block font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1 font-mono text-[12px] text-on-surface">
          {value}
        </code>
        <button
          type="button"
          onClick={() => void onCopy(label, value)}
          title="Copy to clipboard"
          className="shrink-0 text-on-surface-variant hover:text-on-surface"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
            content_copy
          </span>
          <span className="sr-only">Copy {label.toLowerCase()}</span>
        </button>
      </div>
      {copiedLabel === label && (
        <p className="mt-0.5 text-[11px] text-chip-emerald-text">Copied</p>
      )}
    </div>
  );
}

// ---- Customers → iTop organisations ------------------------------------

function CustomersCard() {
  const { data: rows, isLoading, isError } = useItopCustomers();
  const orgsQuery = useItopOrganizations();
  const mapCustomer = useMapItopCustomer();
  const automatch = useAutomatchItopCustomers();
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [pendingRowId, setPendingRowId] = useState<number | null>(null);
  const [automatchMessage, setAutomatchMessage] = useState<string | null>(null);

  if (isError) {
    return (
      <section className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
        <h2 className="font-display text-sm font-semibold text-on-surface">
          Customers → iTop organisations
        </h2>
        <p className="mt-2 text-sm text-error">Failed to load customers.</p>
      </section>
    );
  }

  const list = rows ?? [];
  const matched = list.filter((r) => r.match !== "unmatched").length;
  const orgs = orgsQuery.data ?? [];
  const orgsError = orgsQuery.isError
    ? errorMessage(orgsQuery.error, "Could not reach iTop for the organisation list.")
    : null;

  async function handleOrgChange(row: ItopCustomerRow, rawValue: string) {
    setRowErrors((prev) => ({ ...prev, [row.id]: "" }));
    setPendingRowId(row.id);
    const itopOrgId = rawValue === "" ? null : Number(rawValue);
    try {
      await mapCustomer.mutateAsync({ id: row.id, itopOrgId });
    } catch (err) {
      let message = errorMessage(err, "Failed to update mapping.");
      if (err instanceof ApiError && err.body && typeof err.body === "object") {
        const details = (err.body as { details?: { customerName?: string } }).details;
        if (details?.customerName) message = `Already mapped to ${details.customerName}.`;
      }
      setRowErrors((prev) => ({ ...prev, [row.id]: message }));
    } finally {
      setPendingRowId(null);
    }
  }

  async function handleAutomatch() {
    setAutomatchMessage(null);
    try {
      const res = await automatch.mutateAsync();
      setAutomatchMessage(
        res.matched === 0
          ? "No new exact-name matches found."
          : `Matched ${res.matched} customer${res.matched === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      setAutomatchMessage(errorMessage(err, "Automatch failed."));
    }
  }

  return (
    <section className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-on-surface">
          Customers → iTop organisations
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-on-surface-variant">
            {isLoading ? "—" : `${matched} of ${list.length} matched`}
          </span>
          <button
            type="button"
            onClick={() => void handleAutomatch()}
            disabled={automatch.isPending || orgsQuery.isError}
            className="rounded-sm border border-outline-variant px-3 py-1 font-display text-[12px] font-bold uppercase tracking-wider text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
          >
            {automatch.isPending ? "Matching…" : "Automatch by name"}
          </button>
        </div>
      </div>

      {automatchMessage && (
        <p className="mt-2 text-[12px] text-on-surface-variant">{automatchMessage}</p>
      )}
      {orgsError && <p className="mt-2 text-sm text-error">{orgsError}</p>}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-outline-variant text-left">
              <th className="py-1.5 pr-3 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
                Solvro customer
              </th>
              <th className="py-1.5 pr-3 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
                iTop organisation
              </th>
              <th className="py-1.5 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
                Match
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((row) => (
              <tr key={row.id} className="border-b border-outline-variant/60 last:border-b-0">
                <td className="py-1.5 pr-3 text-on-surface">{row.name}</td>
                <td className="py-1.5 pr-3">
                  <select
                    value={row.itopOrgId ?? ""}
                    onChange={(e) => void handleOrgChange(row, e.target.value)}
                    disabled={orgsQuery.isError || pendingRowId === row.id}
                    className="w-full max-w-[220px] rounded-sm border border-outline-variant bg-surface px-2 py-1 text-sm focus:border-primary focus:outline-hidden disabled:opacity-60"
                  >
                    <option value="">Choose an organisation…</option>
                    {orgs.map((org) => (
                      <option
                        key={org.id}
                        value={org.id}
                        disabled={org.mappedCustomerId !== null && org.mappedCustomerId !== row.id}
                      >
                        {org.name}
                      </option>
                    ))}
                  </select>
                  {rowErrors[row.id] && (
                    <p className="mt-1 text-[11px] text-error">{rowErrors[row.id]}</p>
                  )}
                </td>
                <td className="py-1.5">
                  <Chip tone={MATCH_TONE[row.match]}>{MATCH_LABEL[row.match]}</Chip>
                </td>
              </tr>
            ))}
            {!isLoading && list.length === 0 && (
              <tr>
                <td colSpan={3} className="py-3 text-center text-on-surface-variant">
                  No customers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---- Users → iTop persons ------------------------------------------------

function PersonsCard() {
  const { data, isLoading, isError } = useItopPersons();
  const matchNow = useMatchItopPersons();
  const [matchError, setMatchError] = useState<string | null>(null);

  if (isError) {
    return (
      <section className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
        <h2 className="font-display text-sm font-semibold text-on-surface">
          Users → iTop persons
        </h2>
        <p className="mt-2 text-sm text-error">Failed to load the match report.</p>
      </section>
    );
  }

  const users = data?.users ?? [];
  const unmatched = data?.unmatched ?? 0;
  const matchedCount = users.length - unmatched;

  async function handleMatch() {
    setMatchError(null);
    try {
      await matchNow.mutateAsync();
    } catch (err) {
      setMatchError(errorMessage(err, "Failed to refresh the match report."));
    }
  }

  return (
    <section className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-on-surface">
          Users → iTop persons
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-on-surface-variant">
            {isLoading ? "—" : `${matchedCount} of ${users.length} matched by email`}
          </span>
          <button
            type="button"
            onClick={() => void handleMatch()}
            disabled={matchNow.isPending}
            className="rounded-sm border border-outline-variant px-3 py-1 font-display text-[12px] font-bold uppercase tracking-wider text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
          >
            {matchNow.isPending ? "Matching…" : "Match now"}
          </button>
        </div>
      </div>
      {matchError && <p className="mt-2 text-sm text-error">{matchError}</p>}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-outline-variant text-left">
              <th className="py-1.5 pr-3 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
                Username
              </th>
              <th className="py-1.5 pr-3 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
                Email
              </th>
              <th className="py-1.5 pr-3 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
                Matched
              </th>
              <th className="py-1.5 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
                iTop person ID
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-outline-variant/60 last:border-b-0">
                <td className="py-1.5 pr-3 text-on-surface">{u.username}</td>
                <td className="py-1.5 pr-3 font-mono text-xs text-on-surface-variant">
                  {u.email}
                </td>
                <td className="py-1.5 pr-3">
                  <span
                    aria-hidden="true"
                    className={`material-symbols-outlined text-[16px] ${u.matched ? "text-chip-emerald-text" : "text-error"}`}
                  >
                    {u.matched ? "check_circle" : "cancel"}
                  </span>
                  <span className="sr-only">{u.matched ? "Matched" : "Not matched"}</span>
                </td>
                <td className="py-1.5 font-mono text-xs text-on-surface-variant">
                  {u.itopPersonId ?? "—"}
                </td>
              </tr>
            ))}
            {!isLoading && users.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-center text-on-surface-variant">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[12px] text-on-surface-variant">
        Unmatched users have no "Mine" filter or hours until iTop has their email.
      </p>
    </section>
  );
}
