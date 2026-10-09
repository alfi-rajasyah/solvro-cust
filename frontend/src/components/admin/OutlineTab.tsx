// Admin "Outline" tab: the address of the deployment's self-hosted Outline.
// Solvro only links to it (sidebar item for every user, plus optional
// per-project / per-customer links) — it reads and writes nothing in Outline.
// Backend: backend/src/routes/outlineAdmin.ts
// (docs/archive/plans/outline-integration.md §3). Card pattern follows the
// Sign-in tab in pages/Admin.tsx.
import { useEffect, useId, useState } from "react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal } from "@/components/Modal";
import { Chip } from "@/components/StatusChip";
import { SkeletonRegion } from "@/components/skeletons/SkeletonRegion";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/formatDate";
import { parseOutlineBaseUrl, safeOutlineHref } from "@/lib/outlineUrl";
import { useOutlineAdminSettings, useUpdateOutlineAdminSettings } from "@/lib/queries";

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
        sidebar for every user. Solvro only links to Outline — it reads and writes nothing there.
      </p>

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
  const inputId = useId();
  const helperId = `${inputId}-help`;

  // Reset the draft whenever the dialog opens so it shows the saved value.
  useEffect(() => {
    if (open) {
      setBaseUrl(initialBaseUrl);
      setError(null);
      setConfirmRemove(false);
    }
  }, [open, initialBaseUrl]);

  async function save(next: string | null) {
    setError(null);
    try {
      await update.mutateAsync({ baseUrl: next });
      setConfirmRemove(false);
      onClose();
    } catch (err) {
      setConfirmRemove(false);
      setError(err instanceof ApiError ? err.message : "Could not save the Outline address.");
    }
  }

  function handleSave() {
    const parsed = parseOutlineBaseUrl(baseUrl);
    if (!parsed.ok) {
      setError(parsed.error);
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
      onClose={confirmRemove ? () => {} : onClose}
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
            sidebar link.
          </p>
        </div>
      </form>
    </Modal>
    <ConfirmModal
      open={confirmRemove}
      onClose={() => setConfirmRemove(false)}
      onConfirm={() => void save(null)}
      title="Remove Outline link"
      body="Remove the Outline link? The sidebar link disappears for everyone."
      confirmLabel="Remove"
      confirmTone="danger"
      busy={update.isPending}
    />
    </>
  );
}
