// Admin "Outline" tab: the address of the deployment's self-hosted Outline, the
// OAuth app users connect through ("API access") and the webhook that feeds
// "Mentioned in Outline". Solvro stores no Outline API key or admin token:
// every Outline call runs under the signed-in user's own OAuth token.
// Backend: backend/src/routes/outlineAdmin.ts
// (docs/archive/plans/outline-integration.md §3). Card pattern follows the
// Sign-in tab in pages/Admin.tsx.
import { useEffect, useId, useState } from "react";
import { DISCONNECT_WARNING, OutlineApiCard } from "@/components/admin/OutlineApiCard";
import { OutlineWebhookCard } from "@/components/admin/OutlineWebhookCard";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal } from "@/components/Modal";
import { Chip } from "@/components/StatusChip";
import { SkeletonRegion } from "@/components/skeletons/SkeletonRegion";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/formatDate";
import { parseOutlineBaseUrl, safeOutlineHref } from "@/lib/outlineUrl";
import { useOutlineAdminSettings, useUpdateOutlineAdminSettings } from "@/lib/queries";
import { Alert, AlertDescription } from "@/components/reui/alert";

export function OutlineTab() {
  const { data, isLoading, isError } = useOutlineAdminSettings();
  const [modalOpen, setModalOpen] = useState(false);

  if (isLoading) {
    return (
      <SkeletonRegion className="space-y-4" data-testid="outline-settings-loading">
        <Skeleton className="h-10 w-full max-w-2xl" />
        <Skeleton className="h-32 w-full" />
      </SkeletonRegion>
    );
  }
  if (isError || !data) return <p className="text-error">Failed to load Outline settings.</p>;

  const href = safeOutlineHref(data.baseUrl);
  const linked = href !== null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-on-surface-variant">
        Set the address of your self-hosted Outline. Solvro shows it as an "Outline" link in the
        sidebar for every user. To list pages, search and create docs, register an OAuth app in
        Outline and add its client below; each user then connects their own account in Settings.
      </p>

      {data.baseUrlWarning && (
        <Alert variant="warning" data-testid="outline-base-url-warning">
          <AlertDescription>
            <p>{data.baseUrlWarning}</p>
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={[
                "grid h-10 w-10 shrink-0 place-items-center rounded-full",
                linked
                  ? "bg-chip-emerald-bg text-chip-emerald-text"
                  : "bg-surface-container-high text-on-surface-variant",
              ].join(" ")}
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                menu_book
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-sm font-semibold text-on-surface">
                  Outline workspace
                </span>
                <Chip tone={linked ? "emerald" : "gray"}>{linked ? "Linked" : "Not set"}</Chip>
              </div>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                {linked
                  ? "Shown in every user's sidebar."
                  : "Set an address to show an Outline link in the sidebar."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-semibold text-on-primary hover:bg-primary-container"
          >
            {linked ? "Manage" : "Set address"}
          </button>
        </div>

        {linked && (
          <div className="mt-4 border-t border-outline-variant pt-4">
            <div className="mb-1 font-display text-label-caps uppercase text-on-surface-variant">
              Address
            </div>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="outline-admin-link"
              className="inline-flex max-w-full items-center gap-1.5 break-all rounded-sm bg-surface px-2 py-1.5 font-mono text-meta text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              {href}
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                open_in_new
              </span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        )}

        <div className="mt-4 border-t border-outline-variant pt-3 text-xs text-on-surface-variant">
          {data.updatedBy ? (
            <>
              Last updated by <span className="font-semibold">{data.updatedBy.username}</span> on{" "}
              <span>{fmtDateTime(data.updatedAt)}</span>
            </>
          ) : (
            <>Not changed yet.</>
          )}
        </div>
      </div>

      <OutlineApiCard settings={data} />
      <OutlineWebhookCard settings={data} />

      <OutlineSettingsModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialBaseUrl={data.baseUrl ?? ""}
      />
    </div>
  );
}

function OutlineSettingsModal({
  open,
  onClose,
  initialBaseUrl,
}: {
  open: boolean;
  onClose: () => void;
  initialBaseUrl: string;
}) {
  const update = useUpdateOutlineAdminSettings();
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmChange, setConfirmChange] = useState<string | null>(null);
  const inputId = useId();
  const helperId = `${inputId}-help`;

  // Reset the draft whenever the dialog opens so it shows the saved value.
  useEffect(() => {
    if (open) {
      setBaseUrl(initialBaseUrl);
      setError(null);
      setConfirmRemove(false);
      setConfirmChange(null);
    }
  }, [open, initialBaseUrl]);

  async function save(next: string | null) {
    setError(null);
    try {
      await update.mutateAsync({ baseUrl: next });
      setConfirmRemove(false);
      setConfirmChange(null);
      onClose();
    } catch (err) {
      setConfirmRemove(false);
      setConfirmChange(null);
      setError(err instanceof ApiError ? err.message : "Could not save the Outline address.");
    }
  }

  function handleSave() {
    const parsed = parseOutlineBaseUrl(baseUrl);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    // Pointing Solvro at a different address disconnects every user (their stored
    // tokens belong to the old one), so an existing address needs a confirmation.
    if (initialBaseUrl !== "" && parsed.value !== initialBaseUrl) {
      setConfirmChange(parsed.value ?? "");
      return;
    }
    void save(parsed.value);
  }

  const dirty = baseUrl.trim() !== initialBaseUrl;

  // Modal.tsx's per-instance Escape listener would otherwise close this dialog
  // together with the confirm; keep it open underneath (same as Sign-in).
  return (
    <>
    <Modal
      open={open}
      onClose={confirmRemove || confirmChange !== null ? () => {} : onClose}
      title="Outline address"
      widthClass="max-w-xl"
      footer={
        <>
          {initialBaseUrl !== "" && (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              disabled={update.isPending}
              className="mr-auto rounded-sm px-3 py-1.5 font-display text-xs font-semibold text-error hover:bg-error-container disabled:opacity-50"
            >
              Remove link
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={update.isPending}
            className="rounded-sm px-3 py-1.5 font-display text-xs font-semibold text-on-surface-variant hover:bg-surface-container"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="outline-settings-form"
            disabled={!dirty || update.isPending}
            className="rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-semibold text-on-primary hover:bg-primary-container disabled:opacity-50"
          >
            {update.isPending ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <form
        id="outline-settings-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        className="space-y-3"
      >
        {error && (
          <div
            role="alert"
            className="rounded-sm border border-error/40 bg-error/10 px-3 py-2 text-sm text-error"
          >
            {error}
          </div>
        )}
        <div>
          <label
            htmlFor={inputId}
            className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant"
          >
            Base URL
          </label>
          <input
            id={inputId}
            type="url"
            name="baseUrl"
            value={baseUrl}
            onChange={(e) => {
              setError(null);
              setBaseUrl(e.target.value);
            }}
            placeholder="https://docs.example.com"
            spellCheck={false}
            autoComplete="off"
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={helperId}
            className="w-full rounded-sm border border-outline-variant bg-surface px-2 py-1.5 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
          <p id={helperId} className="mt-1 text-xs text-on-surface-variant">
            http:// or https:// only, without a login, query string or fragment. Empty hides the
            sidebar link. {DISCONNECT_WARNING}
          </p>
        </div>
      </form>
    </Modal>
    <ConfirmModal
      open={confirmRemove}
      onClose={() => setConfirmRemove(false)}
      onConfirm={() => void save(null)}
      title="Remove Outline link"
      body="Remove the Outline link? The sidebar link disappears for everyone, and every user's Outline connection is dropped."
      confirmLabel="Remove"
      confirmTone="danger"
      busy={update.isPending}
    />
    <ConfirmModal
      open={confirmChange !== null}
      onClose={() => setConfirmChange(null)}
      onConfirm={() => void save(confirmChange || null)}
      title="Change the Outline address?"
      body="Changing the address disconnects every user's Outline account and clears the “Mentioned in Outline” index. They will have to connect again in Settings."
      confirmLabel="Change address"
      confirmTone="danger"
      busy={update.isPending}
    />
    </>
  );
}
