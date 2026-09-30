import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Modal } from "@/components/Modal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Chip } from "@/components/StatusChip";
import { ApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { fmtAgo, fmtDateTime } from "@/lib/formatDate";
import { SHARE_LINK_STATUS_LABEL } from "@/lib/labels";
import {
  type CreatedShareLink,
  type ProjectDetail,
  type ShareLink,
  useCreateShareLink,
  useRevokeShareLink,
  useShareLinks,
} from "@/lib/queries";
import { saveErrorMessage } from "@/lib/ownerAccess";
import {
  absoluteShareUrl,
  DEFAULT_SHARE_EXPIRY_DAYS,
  normalizeShareLabel,
  SHARE_EXPIRY_OPTIONS,
  SHARE_LABEL_MAX,
  shareLinkStatus,
  shareLinkTitle,
  type ShareLinkStatus,
} from "@/lib/shareLinks";

// Owner-only header control: create, copy and revoke guest links
// (docs/archive/plans/collaboration-and-sharing.md, L4). The full link exists
// only in the create response, so it is shown once here with a Copy button and
// can never be recovered from the list.

const FOCUS_RING = "outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30";

const STATUS_TONE: Record<ShareLinkStatus, "emerald" | "amber" | "gray"> = {
  active: "emerald",
  expired: "amber",
  revoked: "gray",
};

export function ProjectShareButton({ project }: { project: ProjectDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Share with a guest"
        title="Share with a guest"
        data-testid="share-button"
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest px-2 font-display text-xs font-bold text-on-surface transition-colors hover:bg-surface-container ${FOCUS_RING}`}
      >
        <span className="material-symbols-outlined text-base" aria-hidden="true">
          ios_share
        </span>
        <span className="hidden md:inline">Share</span>
      </button>
      <ProjectShareDialog project={project} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function ProjectShareDialog({
  project,
  open,
  onClose,
}: {
  project: ProjectDetail;
  open: boolean;
  onClose: () => void;
}) {
  const links = useShareLinks(project.id, open);
  const create = useCreateShareLink(project.id);
  const revoke = useRevokeShareLink(project.id);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(DEFAULT_SHARE_EXPIRY_DAYS);
  const [created, setCreated] = useState<CreatedShareLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Link whose revocation awaits the in-dialog confirmation.
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  // Where focus goes once a revocation finishes: the confirm row (and the
  // Revoke button it replaced) is gone by then, and focus on <body> would let
  // the next Tab leave the dialog.
  const listHeading = useRef<HTMLHeadingElement>(null);
  const listSection = useRef<HTMLElement>(null);
  const labelInput = useRef<HTMLInputElement>(null);

  // The heading is focusable but not tabbable, so the dialog's Tab trap (which
  // only wraps from the last tabbable element) would let a forward Tab from it
  // leave the dialog when no Revoke button follows. Wrap to the first field.
  function handleHeadingKeyDown(e: KeyboardEvent<HTMLHeadingElement>) {
    if (e.key !== "Tab" || e.shiftKey) return;
    if (listSection.current?.querySelector("button:not([disabled])")) return;
    e.preventDefault();
    labelInput.current?.focus();
  }

  function close() {
    // The new link is dropped on purpose: it is shown once and never stored.
    setCreated(null);
    setError(null);
    setConfirmingId(null);
    setLabel("");
    setDays(DEFAULT_SHARE_EXPIRY_DAYS);
    onClose();
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await create.mutateAsync({
        label: normalizeShareLabel(label),
        expiresInDays: days,
      });
      setCreated(res);
      setLabel("");
    } catch (err) {
      setError(saveErrorMessage(err, "Could not create the link."));
    }
  }

  async function handleRevoke(link: ShareLink) {
    setError(null);
    // The confirm row stays until the request settles so the focused
    // "Revoke link" button is not unmounted mid-click.
    try {
      await revoke.mutateAsync(link.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not revoke the link.");
    }
    setConfirmingId(null);
    listHeading.current?.focus();
  }

  const now = new Date();

  return (
    <Modal open={open} onClose={close} title="Share with a guest" widthClass="max-w-xl">
      <div className="space-y-5">
        <p className="text-xs text-on-surface-variant">
          Anyone with a guest link can view a read-only summary of this project without signing in:
          its name, customer and status, each phase with its dates and progress, and the
          milestones. Nothing else is shared — no tasks, notes, comments, risks or people.
        </p>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={(e) => void handleCreate(e)} className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-label-caps uppercase text-on-surface-variant">
                Label (optional)
              </span>
              <input
                ref={labelInput}
                type="text"
                value={label}
                maxLength={SHARE_LABEL_MAX}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. For Nusantara IT"
                className={`rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant ${FOCUS_RING}`}
              />
            </label>
            <label className="flex flex-col gap-1 sm:w-36">
              <span className="text-label-caps uppercase text-on-surface-variant">Expires after</span>
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className={`rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface ${FOCUS_RING}`}
              >
                {SHARE_EXPIRY_OPTIONS.map((o) => (
                  <option key={o.days} value={o.days}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={create.isPending}
            className={`rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60 ${FOCUS_RING}`}
          >
            {create.isPending ? "Creating…" : "Create link"}
          </button>
        </form>

        {created && <NewLinkPanel link={created} />}

        <section ref={listSection} aria-labelledby="share-links-heading">
          <h3
            id="share-links-heading"
            ref={listHeading}
            tabIndex={-1}
            onKeyDown={handleHeadingKeyDown}
            className="mb-2 text-label-caps uppercase text-on-surface-variant outline-hidden"
          >
            Guest links
          </h3>
          {links.isLoading ? (
            <div className="space-y-2" data-testid="share-links-loading">
              <span className="sr-only">Loading links</span>
              {[0, 1].map((i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  className="h-12 animate-pulse rounded-sm bg-surface-container-low"
                />
              ))}
            </div>
          ) : links.isError ? (
            <p className="text-xs text-error">Couldn't load the guest links.</p>
          ) : (links.data ?? []).length === 0 ? (
            <p className="rounded-sm border border-dashed border-outline-variant px-3 py-4 text-xs text-on-surface-variant">
              No guest links yet.
            </p>
          ) : (
            <ul className="divide-y divide-outline-variant/60" data-testid="share-links-list">
              {(links.data ?? []).map((link) => (
                <ShareLinkRow
                  key={link.id}
                  link={link}
                  now={now}
                  busy={revoke.isPending && revoke.variables === link.id}
                  confirming={confirmingId === link.id}
                  onAskRevoke={() => setConfirmingId(link.id)}
                  onCancel={() => setConfirmingId(null)}
                  onRevoke={() => void handleRevoke(link)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}

function NewLinkPanel({ link }: { link: CreatedShareLink }) {
  const url = absoluteShareUrl(link.url, window.location.origin);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function handleCopy() {
    let next: "copied" | "failed" = "copied";
    try {
      await copyText(url);
    } catch {
      // Selecting the text lets the person copy it by hand.
      input.current?.select();
      next = "failed";
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2500);
  }

  return (
    <section
      aria-label="New guest link"
      data-testid="share-new-link"
      className="space-y-2 rounded-sm border border-primary/40 bg-primary/5 p-3"
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={input}
          readOnly
          value={url}
          aria-label="Guest link"
          data-testid="share-new-link-url"
          onFocus={(e) => e.currentTarget.select()}
          className={`min-w-0 flex-1 rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1.5 font-mono text-xs text-on-surface ${FOCUS_RING}`}
        />
        <button
          type="button"
          onClick={() => void handleCopy()}
          className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 ${FOCUS_RING}`}
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            {state === "copied" ? "check" : "content_copy"}
          </span>
          {state === "copied" ? "Copied" : "Copy link"}
        </button>
      </div>
      <p className="text-xs text-on-surface">You won't see this link again — copy it now.</p>
      {/* Live region for both outcomes; a success is announced only to
          screen readers (the button already reads "Copied"). */}
      <p role="status" className={state === "failed" ? "text-xs text-error" : "sr-only"}>
        {state === "copied"
          ? "Link copied to clipboard."
          : state === "failed"
            ? "Could not copy automatically — the link is selected, press Ctrl+C."
            : ""}
      </p>
    </section>
  );
}

function ShareLinkRow({
  link,
  now,
  busy,
  confirming,
  onAskRevoke,
  onCancel,
  onRevoke,
}: {
  link: ShareLink;
  now: Date;
  busy: boolean;
  confirming: boolean;
  onAskRevoke: () => void;
  onCancel: () => void;
  onRevoke: () => void;
}) {
  const status = shareLinkStatus(link, now);
  const title = shareLinkTitle(link);
  const revokeButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  // Set by Cancel so focus returns to the Revoke button that opened the
  // confirmation; a finished revoke instead lands on the list heading (the
  // dialog handles that), so this is not a blanket "confirm closed" rule.
  const cancelled = useRef(false);
  useEffect(() => {
    if (confirming) {
      cancelButton.current?.focus();
    } else if (cancelled.current) {
      cancelled.current = false;
      revokeButton.current?.focus();
    }
  }, [confirming]);

  return (
    <li className="py-2.5" data-testid="share-link-row">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-on-surface">{title}</p>
            <Chip tone={STATUS_TONE[status]}>{SHARE_LINK_STATUS_LABEL[status]}</Chip>
          </div>
          <p className="text-meta text-on-surface-variant">
            {link.createdBy ? `Created by ${link.createdBy.username} · ` : "Created · "}
            {fmtDateTime(link.createdAt, now)}
          </p>
          <p className="text-meta text-on-surface-variant">
            {status === "revoked" && link.revokedAt
              ? `Revoked ${fmtDateTime(link.revokedAt, now)}`
              : `${status === "expired" ? "Expired" : "Expires"} ${fmtDateTime(link.expiresAt, now)}`}
            {" · "}
            {link.lastUsedAt ? `Last used ${fmtAgo(link.lastUsedAt, now)}` : "Never used"}
          </p>
        </div>
        {status === "active" && !confirming && (
          <button
            ref={revokeButton}
            type="button"
            onClick={onAskRevoke}
            aria-label={`Revoke ${title}`}
            className={`shrink-0 rounded-lg border border-outline-variant px-3 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container hover:text-error ${FOCUS_RING}`}
          >
            Revoke
          </button>
        )}
      </div>
      {confirming && (
        <div
          data-testid="share-revoke-confirm"
          className="mt-2 flex flex-wrap items-center gap-2 rounded-sm bg-surface-container-low px-3 py-2"
        >
          <p className="min-w-0 flex-1 text-xs text-on-surface">
            Anyone using this link loses access immediately. This can't be undone.
          </p>
          <button
            ref={cancelButton}
            type="button"
            onClick={() => {
              cancelled.current = true;
              onCancel();
            }}
            disabled={busy}
            className={`rounded-lg border border-outline-variant px-3 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container ${FOCUS_RING}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onRevoke}
            disabled={busy}
            className={`rounded-lg bg-error px-3 py-1 text-xs font-bold text-on-error hover:bg-error/90 disabled:opacity-60 ${FOCUS_RING}`}
          >
            {busy ? "Revoking…" : "Revoke link"}
          </button>
        </div>
      )}
    </li>
  );
}
