import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal } from "@/components/Modal";
import { CopyField } from "@/components/admin/CopyField";
import { SkeletonRegion } from "@/components/skeletons/SkeletonRegion";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Chip } from "@/components/StatusChip";
import { EMPTY_VALUE } from "@/lib/emptyValue";
import { fmtAgo } from "@/lib/formatDate";
import { inboundHookDisabledLabel } from "@/lib/labels";
import { saveErrorMessage } from "@/lib/ownerAccess";
import {
  useClearInboundHookSigningSecret,
  useCreateInboundHook,
  useDeleteInboundHook,
  useInboundHooks,
  useRotateInboundHookToken,
  useSetInboundHookSigningSecret,
  useUpdateInboundHook,
  type InboundHook,
} from "@/lib/queries";

// Owner-only dialog on the project page (docs/archive/plans/webhooks.md,
// Phase 2): the project's incoming webhook URLs. The full URL and the signing
// secret exist only in the response that makes them, so they are shown once in
// the "reveal" panel and dropped when it is dismissed or the dialog closes.

const FOCUS_RING_BORDERED =
  "outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30";
const ROW_BUTTON = `[@media(pointer:coarse)]:min-h-11 rounded-sm border border-outline-variant px-2.5 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-60 focus-visible:border-primary ${FOCUS_RING_BORDERED}`;

// Where focus goes back to once a panel or dialog closes: the row's button for
// `action`, or the Name input when that row or button is gone.
type FocusTarget = { hookId: number; action: RowAction } | null;
type RowAction = "rotate" | "secret" | "delete";

type Reveal =
  | {
      kind: "url";
      hookName: string;
      url: string | null;
      token: string | null;
      rotated: boolean;
      origin: FocusTarget;
    }
  | { kind: "secret"; hookName: string; secret: string; origin: FocusTarget };

type ConfirmKind =
  "rotate" | "delete" | "clear-signature" | "require-signature" | "new-secret";
type Confirm = { kind: ConfirmKind; hook: InboundHook };

export function ProjectIntegrationsDialog({
  projectId,
  open,
  onClose,
}: {
  projectId: number;
  open: boolean;
  onClose: () => void;
}) {
  const hooks = useInboundHooks(projectId, open);
  const create = useCreateInboundHook(projectId);
  const update = useUpdateInboundHook(projectId);
  const remove = useDeleteInboundHook(projectId);
  const rotate = useRotateInboundHookToken(projectId);
  const setSecret = useSetInboundHookSigningSecret(projectId);
  const clearSecret = useClearInboundHookSigningSecret(projectId);

  const [name, setName] = useState("");
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef<{ target: FocusTarget } | null>(null);

  // Focus returns here once no dialog or panel is in the way. ConfirmModal
  // already restores focus to its trigger; this covers a trigger that is gone
  // (a deleted row, a button that swapped) and the reveal panel's dismissal.
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || confirm || reveal) return;
    pendingFocus.current = null;
    const t = pending.target;
    const el = t
      ? document.querySelector<HTMLElement>(
          `[data-testid="inbound-hook-${t.hookId}"] [data-action="${t.action}"]`,
        )
      : null;
    (el ?? nameInput.current)?.focus();
  }, [confirm, reveal, hooks.data]);

  const busy =
    update.isPending ||
    remove.isPending ||
    rotate.isPending ||
    setSecret.isPending ||
    clearSecret.isPending;

  function close() {
    // The URL and the secret are dropped on purpose: they are shown once.
    setReveal(null);
    setConfirm(null);
    pendingFocus.current = null;
    setError(null);
    setName("");
    onClose();
  }

  async function run(action: () => Promise<void>, fallback: string) {
    setError(null);
    // A row button is disabled while its request runs, which drops focus to
    // <body>; put it back once the button is enabled again.
    const prev = document.activeElement as HTMLElement | null;
    try {
      await action();
    } catch (err) {
      setError(saveErrorMessage(err, fallback));
    }
    setConfirm(null);
    requestAnimationFrame(() => {
      const lost =
        !document.activeElement || document.activeElement === document.body;
      if (lost && prev?.isConnected) prev.focus();
    });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const res = await create.mutateAsync({ name: trimmed });
      setReveal({
        kind: "url",
        hookName: res.hook.name,
        url: res.url,
        token: res.token ?? null,
        rotated: false,
        origin: null,
      });
      setName("");
    } catch (err) {
      setError(saveErrorMessage(err, "Could not create the URL."));
      // The Add button was disabled while pending; the error shows above the
      // Name field, so focus goes there.
      requestAnimationFrame(() => nameInput.current?.focus());
    }
  }

  async function handleConfirm() {
    const c = confirm;
    if (!c) return;
    const { hook: h } = c;
    if (c.kind === "rotate") {
      await run(async () => {
        const res = await rotate.mutateAsync(h.id);
        setReveal({
          kind: "url",
          hookName: h.name,
          url: res.url,
          token: res.token ?? null,
          rotated: true,
          origin: { hookId: h.id, action: "rotate" },
        });
      }, `Could not rotate the URL of ${h.name}.`);
    } else if (c.kind === "require-signature" || c.kind === "new-secret") {
      await run(async () => {
        const res = await setSecret.mutateAsync(h.id);
        setReveal({
          kind: "secret",
          hookName: h.name,
          secret: res.secret,
          origin: { hookId: h.id, action: "secret" },
        });
      }, `Could not create a signing secret for ${h.name}.`);
    } else if (c.kind === "clear-signature") {
      pendingFocus.current = { target: { hookId: h.id, action: "secret" } };
      await run(async () => {
        await clearSecret.mutateAsync(h.id);
      }, `Could not stop requiring a signature for ${h.name}.`);
    } else {
      pendingFocus.current = { target: null };
      await run(async () => {
        await remove.mutateAsync(h.id);
      }, `Could not delete ${h.name}.`);
    }
  }

  const list = hooks.data ?? [];

  return (
    <>
      <Modal
        open={open}
        onClose={confirm ? () => {} : close}
        title="Integrations"
        widthClass="max-w-xl"
      >
        <div className="space-y-5">
          <p className="text-xs text-on-surface-variant">
            An incoming URL lets another tool add comments to this
            project&apos;s tasks. Paste the URL into the tool&apos;s webhook
            settings and choose JSON. Put task links in commit messages or
            titles, and Solvro comments on each task it finds.
          </p>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form
            onSubmit={(e) => void handleCreate(e)}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-label-caps uppercase text-on-surface-variant">
                Name
              </span>
              <input
                ref={nameInput}
                type="text"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. GitLab"
                className={`[@media(pointer:coarse)]:min-h-11 rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant focus-visible:border-primary ${FOCUS_RING_BORDERED}`}
              />
            </label>
            <button
              type="submit"
              disabled={create.isPending || name.trim() === ""}
              className="[@media(pointer:coarse)]:min-h-11 rounded-sm bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60 outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {create.isPending ? "Adding…" : "Add URL"}
            </button>
          </form>

          <div aria-live="polite" className="sr-only">
            {reveal ? revealAnnouncement(reveal) : ""}
          </div>
          {reveal && (
            <RevealPanel
              reveal={reveal}
              onDismiss={() => {
                pendingFocus.current = { target: reveal.origin };
                setReveal(null);
              }}
            />
          )}

          <section aria-labelledby="inbound-hooks-heading">
            <h2
              id="inbound-hooks-heading"
              className="mb-2 text-label-caps uppercase text-on-surface-variant"
            >
              Incoming URLs
            </h2>
            {hooks.isLoading ? (
              <SkeletonRegion
                className="space-y-2"
                data-testid="inbound-hooks-loading"
              >
                {[0, 1].map((i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </SkeletonRegion>
            ) : hooks.isError ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {saveErrorMessage(
                    hooks.error,
                    "Could not load the incoming URLs.",
                  )}
                </AlertDescription>
              </Alert>
            ) : list.length === 0 ? (
              <p className="text-xs text-on-surface-variant">
                No incoming URLs yet. Add one to connect a tool.
              </p>
            ) : (
              <ul className="divide-y divide-outline-variant rounded-sm border border-outline-variant">
                {list.map((h) => (
                  <HookRow
                    key={h.id}
                    hook={h}
                    busy={busy}
                    onAsk={(kind) => setConfirm({ kind, hook: h })}
                    onToggle={() =>
                      void run(
                        async () => {
                          await update.mutateAsync({
                            hookId: h.id,
                            active: !h.active,
                          });
                        },
                        `Could not ${h.active ? "disable" : "enable"} ${h.name}.`,
                      )
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </Modal>
      <ConfirmModal
        open={confirm != null}
        onClose={() => setConfirm(null)}
        onConfirm={() => void handleConfirm()}
        title={confirm ? CONFIRM_COPY[confirm.kind].title : ""}
        body={confirm ? CONFIRM_COPY[confirm.kind].body(confirm.hook.name) : ""}
        confirmLabel={confirm ? CONFIRM_COPY[confirm.kind].label : ""}
        confirmTone={confirm ? CONFIRM_COPY[confirm.kind].tone : "primary"}
        busy={busy}
      />
    </>
  );
}

function revealAnnouncement(reveal: Reveal): string {
  const what =
    reveal.kind === "secret" ? "signing secret" : reveal.url ? "URL" : "token";
  return `New ${what} for ${reveal.hookName} is shown below. Copy it now, it is shown once.`;
}

function RevealPanel({
  reveal,
  onDismiss,
}: {
  reveal: Reveal;
  onDismiss: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  // Focus lands on the copy button, the one thing to do with a one-time value.
  // Deferred one frame so it lands after a closing ConfirmModal has handed
  // focus back to its trigger.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      panel.current
        ?.querySelector<HTMLElement>('button[aria-label^="Copy"]')
        ?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  let intro: string;
  let field: ReactNode;
  if (reveal.kind === "secret") {
    intro = `Signing secret for ${reveal.hookName}. Give it to the sending tool so it signs each request.`;
    field = (
      <CopyField
        value={reveal.secret}
        label="signing secret"
        testId="inbound-secret"
      />
    );
  } else if (reveal.url) {
    intro = reveal.rotated
      ? `New URL for ${reveal.hookName}. The old URL no longer works.`
      : `URL for ${reveal.hookName}. Paste it into the tool's webhook settings.`;
    field = <CopyField value={reveal.url} label="URL" testId="inbound-url" />;
  } else {
    intro = `The server has no public address set, so Solvro cannot build the full URL for ${reveal.hookName}. Ask the server admin to set APP_URL. This is the token for that URL.`;
    field = (
      <CopyField
        value={reveal.token ?? ""}
        label="token"
        testId="inbound-token"
      />
    );
  }
  return (
    <section
      ref={panel}
      aria-label="Shown once"
      data-testid="inbound-reveal"
      className="space-y-2 rounded-sm border border-primary/40 bg-primary/5 p-3"
    >
      <p className="text-xs text-on-surface">{intro}</p>
      {field}
      <p role="note" className="text-meta text-on-surface-variant">
        {reveal.kind === "secret"
          ? "Shown once. If you lose it, generate a new secret."
          : "Shown once. If you lose it, rotate the URL."}
      </p>
      <button type="button" onClick={onDismiss} className={ROW_BUTTON}>
        I have saved it
      </button>
    </section>
  );
}

const CONFIRM_COPY: Record<
  ConfirmKind,
  {
    title: string;
    body: (name: string) => string;
    label: string;
    tone: "primary" | "danger";
  }
> = {
  rotate: {
    title: "Rotate URL?",
    body: (n) =>
      `The current URL of ${n} stops working at once. Update the tool with the new one.`,
    label: "Rotate URL",
    tone: "danger",
  },
  delete: {
    title: "Delete URL?",
    body: (n) => `${n} stops working and cannot be restored.`,
    label: "Delete URL",
    tone: "danger",
  },
  "clear-signature": {
    title: "Stop requiring a signature?",
    body: (n) =>
      `${n} will accept requests that have the URL alone, signed or not.`,
    label: "Stop requiring",
    tone: "danger",
  },
  "require-signature": {
    title: "Require a signature?",
    body: (n) =>
      `Requests to ${n} without a valid Standard Webhooks signature fail from now on. The sending tool must sign with the secret shown next.`,
    label: "Require signature",
    tone: "primary",
  },
  "new-secret": {
    title: "Make a new signing secret?",
    body: (n) =>
      `The current secret of ${n} stops working at once. Requests signed with it fail until the sending tool has the new one.`,
    label: "New secret",
    tone: "primary",
  },
};

function HookRow({
  hook: h,
  busy,
  onAsk,
  onToggle,
}: {
  hook: InboundHook;
  busy: boolean;
  onAsk: (kind: ConfirmKind) => void;
  onToggle: () => void;
}) {
  return (
    <li className="space-y-2 px-3 py-3" data-testid={`inbound-hook-${h.id}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words font-display text-sm font-semibold text-on-surface">
          {h.name}
        </span>
        <Chip tone={h.active ? "emerald" : "amber"}>
          {h.active ? "Active" : "Disabled"}
        </Chip>
        {h.hasSigningSecret && <Chip tone="gray">Signature required</Chip>}
      </div>
      <p className="font-mono text-meta text-on-surface-variant">
        {h.tokenPreview}…
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-meta">
        <dt className="text-on-surface-variant">Last received</dt>
        <dd className="text-on-surface">
          {h.lastReceivedAt ? fmtAgo(h.lastReceivedAt) : "Never"}
        </dd>
        <dt className="text-on-surface-variant">Created by</dt>
        <dd className="text-on-surface">{h.createdBy.name || EMPTY_VALUE}</dd>
      </dl>
      <p className="text-meta text-on-surface-variant">
        Comments are written as {h.createdBy.name || EMPTY_VALUE}.
      </p>
      {!h.active && h.disabledReason && (
        <p className="text-meta text-chip-amber-text">
          {inboundHookDisabledLabel(h.disabledReason)}
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          data-action="rotate"
          onClick={() => onAsk("rotate")}
          disabled={busy}
          className={ROW_BUTTON}
        >
          Rotate URL
        </button>
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          className={ROW_BUTTON}
        >
          {h.active ? "Disable" : "Enable"}
        </button>
        {h.hasSigningSecret ? (
          <>
            <button
              type="button"
              data-action="secret"
              onClick={() => onAsk("new-secret")}
              disabled={busy}
              className={ROW_BUTTON}
            >
              New signing secret
            </button>
            <button
              type="button"
              onClick={() => onAsk("clear-signature")}
              disabled={busy}
              className={ROW_BUTTON}
            >
              Stop requiring a signature
            </button>
          </>
        ) : (
          <button
            type="button"
            data-action="secret"
            onClick={() => onAsk("require-signature")}
            disabled={busy}
            className={ROW_BUTTON}
          >
            Require a Standard Webhooks signature
          </button>
        )}
        <button
          type="button"
          data-action="delete"
          onClick={() => onAsk("delete")}
          disabled={busy}
          className={`${ROW_BUTTON} text-error`}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
