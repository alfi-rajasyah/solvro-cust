import { useEffect, useId, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { copyText } from "@/lib/clipboard";
import {
  buildEmbedUrl,
  buildGuestEmbedUrl,
  EMBED_VIEWS,
  type EmbedView,
} from "@/lib/embedViews";
import { saveErrorMessage } from "@/lib/ownerAccess";
import { type ProjectDetail, useCreateShareLink, useProjectEpics } from "@/lib/queries";
import { absoluteShareUrl, DEFAULT_SHARE_EXPIRY_DAYS } from "@/lib/shareLinks";

// "Embed in Outline" (project header ⋯ menu): builds the link a TAM pastes into
// an Outline page (docs/archive/plans/outline-integration.md, Phase C). Two
// audiences: signed-in Solvro users (the /embed/projects/:id/* views, session
// based) or anyone with a guest link (the timeline only, `?embed=1`). A guest
// link's token is only ever shown in its create response, so an existing link
// cannot be listed and reused: the owner creates a dedicated one here, on
// purpose, and sees it once.

const FOCUS_RING = "outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30";
const GUEST_LABEL = "Outline embed";

type Audience = "signed-in" | "guest";

export function EmbedInOutlineDialog({
  project,
  open,
  onClose,
  canCreateGuestLink,
}: {
  project: ProjectDetail;
  open: boolean;
  onClose: () => void;
  /** Same rule as the Share control: owners with project:write. */
  canCreateGuestLink: boolean;
}) {
  const [audience, setAudience] = useState<Audience>("signed-in");
  const [view, setView] = useState<EmbedView>("tasks");
  const [epicId, setEpicId] = useState<number | null>(null);
  const [guestUrl, setGuestUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const epics = useProjectEpics(open ? project.id : null);
  const create = useCreateShareLink(project.id);
  const idBase = useId();

  const guest = audience === "guest";
  // Guests only ever see the timeline, whatever card was picked before.
  const effectiveView: EmbedView = guest ? "timeline" : view;

  function close() {
    // A guest link is shown once and never kept - not in state, and not in the
    // mutation's cached result either (its response carries the token).
    setGuestUrl(null);
    create.reset();
    setError(null);
    setAudience("signed-in");
    setView("tasks");
    setEpicId(null);
    onClose();
  }

  async function handleCreate() {
    setError(null);
    try {
      const res = await create.mutateAsync({
        label: GUEST_LABEL,
        expiresInDays: DEFAULT_SHARE_EXPIRY_DAYS,
      });
      setGuestUrl(buildGuestEmbedUrl(absoluteShareUrl(res.url, window.location.origin)));
    } catch (err) {
      setError(saveErrorMessage(err, "Could not create the guest link."));
    }
  }

  const signedInUrl = buildEmbedUrl(window.location.origin, project.id, effectiveView, epicId);

  return (
    <Modal open={open} onClose={close} title="Embed in Outline" widthClass="max-w-xl">
      <div className="space-y-5">
        <p className="text-xs text-on-surface-variant">
          Paste the link into an Outline page; Outline shows it as a live, read-only panel.
        </p>

        <fieldset className="space-y-2">
          <legend className="text-label-caps uppercase text-on-surface-variant">View</legend>
          <div className="grid gap-2 sm:grid-cols-3" data-testid="embed-view-cards">
            {EMBED_VIEWS.map((v) => {
              const disabled = guest && v.id !== "timeline";
              const checked = effectiveView === v.id;
              return (
                <label
                  key={v.id}
                  className={[
                    "flex cursor-pointer flex-col gap-1 rounded-sm border p-3 has-focus-visible:ring-2 has-focus-visible:ring-primary/30",
                    checked
                      ? "border-primary bg-primary/5"
                      : "border-outline-variant bg-surface-container-lowest hover:bg-surface-container",
                    disabled ? "cursor-not-allowed opacity-50 hover:bg-surface-container-lowest" : "",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name={`${idBase}-view`}
                    value={v.id}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => setView(v.id)}
                    className="sr-only"
                  />
                  <span className="flex items-center gap-1.5 font-display text-sm font-semibold text-on-surface">
                    <span className="material-symbols-outlined text-base" aria-hidden="true">
                      {v.icon}
                    </span>
                    {v.label}
                  </span>
                  <span className="text-meta text-on-surface-variant">{v.hint}</span>
                </label>
              );
            })}
          </div>
          {guest && (
            <p className="text-meta text-on-surface-variant">
              A guest link shows the timeline only: phases and milestones.
            </p>
          )}
        </fieldset>

        {!guest && effectiveView === "tasks" && (
          <label className="flex flex-col gap-1">
            <span className="text-label-caps uppercase text-on-surface-variant">Filter</span>
            <select
              value={epicId ?? ""}
              onChange={(e) => setEpicId(e.target.value ? Number(e.target.value) : null)}
              aria-label="Filter by epic"
              className={`rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface ${FOCUS_RING}`}
            >
              <option value="">All tasks</option>
              {(epics.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  Epic: {e.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <fieldset className="space-y-2">
          <legend className="text-label-caps uppercase text-on-surface-variant">Who can see it</legend>
          <div className="space-y-1.5">
            {(
              [
                ["signed-in", "Signed-in Solvro users"],
                ["guest", "Anyone with the link"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-on-surface">
                <input
                  type="radio"
                  name={`${idBase}-audience`}
                  value={value}
                  checked={audience === value}
                  onChange={() => setAudience(value)}
                  className={`accent-primary ${FOCUS_RING}`}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <section aria-label="Embed link" className="space-y-2">
          {!guest ? (
            <LinkField url={signedInUrl} label="Embed link" testId="embed-link-url" />
          ) : guestUrl ? (
            <>
              <LinkField url={guestUrl} label="Guest embed link" testId="embed-link-url" />
              <p className="text-xs text-on-surface">You won't see this link again — copy it now.</p>
            </>
          ) : canCreateGuestLink ? (
            <div className="space-y-2 rounded-sm border border-dashed border-outline-variant p-3">
              <p className="text-xs text-on-surface-variant">
                An existing guest link can't be shown again, so this creates a new one for the
                embed, expiring in {DEFAULT_SHARE_EXPIRY_DAYS} days. You can revoke it from Share.
              </p>
              <button
                type="button"
                data-testid="embed-create-guest"
                onClick={() => void handleCreate()}
                disabled={create.isPending}
                className={`rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60 ${FOCUS_RING}`}
              >
                {create.isPending ? "Creating…" : "Create guest link"}
              </button>
            </div>
          ) : (
            <p
              data-testid="embed-guest-owner-hint"
              className="rounded-sm border border-dashed border-outline-variant px-3 py-4 text-xs text-on-surface-variant"
            >
              Ask the project owner for a guest link.
            </p>
          )}
        </section>

        <p
          data-testid="embed-domain-note"
          className="rounded-sm bg-chip-amber-bg px-3 py-2 text-xs text-chip-amber-text"
        >
          Signed-in works only when Solvro and Outline share a parent domain (solvro.acme.com +
          docs.acme.com). Readers without Solvro access see a sign-in prompt. A guest link shows
          the view to anyone who opens the page.
        </p>
      </div>
    </Modal>
  );
}

function LinkField({ url, label, testId }: { url: string; label: string; testId: string }) {
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
    <div className="space-y-1">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={input}
          readOnly
          value={url}
          aria-label={label}
          data-testid={testId}
          onFocus={(e) => e.currentTarget.select()}
          className={`min-w-0 flex-1 rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1.5 font-mono text-xs text-on-surface ${FOCUS_RING}`}
        />
        <button
          type="button"
          data-testid="embed-copy"
          onClick={() => void handleCopy()}
          className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 ${FOCUS_RING}`}
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            {state === "copied" ? "check" : "content_copy"}
          </span>
          {state === "copied" ? "Copied" : "Copy link"}
        </button>
      </div>
      <p role="status" className={state === "failed" ? "text-xs text-error" : "sr-only"}>
        {state === "copied"
          ? "Link copied to clipboard."
          : state === "failed"
            ? "Could not copy automatically — the link is selected, press Ctrl+C."
            : ""}
      </p>
    </div>
  );
}
