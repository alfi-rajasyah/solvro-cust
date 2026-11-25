import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Modal } from "@/components/Modal";
import { TableSkeleton } from "@/components/skeletons";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  WEBHOOK_EVENT_TYPES,
  useCreateWebhook,
  useProjects,
  useUpdateWebhook,
  type Webhook,
  type WebhookFormat,
} from "@/lib/queries";
import { WEBHOOK_EVENT_LABEL, WEBHOOK_FORMAT_LABEL } from "@/lib/labels";
import { WEBHOOK_MAX_PROJECTS, webhookErrorMessage } from "./webhookPresentation";

const INPUT_CLASS =
  "[@media(pointer:coarse)]:min-h-11 w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-70";

/**
 * Create (no `webhook`) or edit one outgoing webhook. `onCreated` receives the
 * one-time secret (null for Google Chat); the caller shows it.
 */
export function WebhookFormModal({
  open,
  webhook,
  onClose,
  onCreated,
}: {
  open: boolean;
  webhook: Webhook | null;
  onClose: () => void;
  onCreated: (webhook: Webhook, secret: string | null) => void;
}) {
  const isEdit = webhook != null;
  const create = useCreateWebhook();
  const update = useUpdateWebhook();
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const formId = useId();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<WebhookFormat>("STANDARD");
  const [events, setEvents] = useState<string[]>([]);
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [projectIds, setProjectIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Seed on open or when another webhook is edited, not on every list refetch
  // (a refetch hands back a new object and would wipe what the user typed).
  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(webhook?.name ?? "");
    setUrl("");
    setFormat(webhook?.format ?? "STANDARD");
    setEvents(webhook?.eventTypes ?? []);
    setScope(webhook && webhook.projectIds.length > 0 ? "selected" : "all");
    setProjectIds(webhook?.projectIds ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, webhook?.id]);

  const sortedProjects = useMemo(
    () => [...(projects ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  );

  function toggleEvent(type: string, on: boolean) {
    setEvents((prev) => (on ? [...prev, type] : prev.filter((e) => e !== type)));
  }
  function toggleProject(id: number, on: boolean) {
    setProjectIds((prev) => (on ? [...prev, id] : prev.filter((p) => p !== id)));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) return setError("Name is required.");
    // Editing: a blank URL keeps the stored one (the browser never holds it).
    if (!isEdit && !url.trim()) return setError("URL is required.");
    if (events.length === 0) return setError("Pick at least one event.");
    if (scope === "selected" && projectIds.length === 0) {
      return setError("Pick at least one project, or send events from every project you can see.");
    }
    // Contract order, whatever order the boxes were ticked in.
    const eventTypes = WEBHOOK_EVENT_TYPES.filter((t) => events.includes(t));
    const ids = scope === "all" ? [] : projectIds;
    try {
      if (webhook) {
        await update.mutateAsync({
          id: webhook.id,
          name: trimmed,
          ...(url.trim() ? { url: url.trim() } : {}),
          eventTypes,
          projectIds: ids,
        });
        onClose();
      } else {
        const res = await create.mutateAsync({
          name: trimmed,
          url: url.trim(),
          format,
          eventTypes,
          projectIds: ids,
        });
        onCreated(res.webhook, res.secret);
      }
    } catch (err) {
      setError(webhookErrorMessage(err, "Could not save the webhook."));
    }
  }

  const busy = create.isPending || update.isPending;

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={isEdit ? "Edit webhook" : "New webhook"}
      widthClass="max-w-xl"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="[@media(pointer:coarse)]:min-h-11 rounded-sm border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50 focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={busy}
            className="[@media(pointer:coarse)]:min-h-11 rounded-sm bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create webhook"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-5" noValidate>
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoFocus
            placeholder="Delivery channel"
            className={INPUT_CLASS}
          />
        </Field>

        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-label-caps uppercase text-on-surface-variant">Format</legend>
          <div className="space-y-1.5">
            {(["STANDARD", "GOOGLE_CHAT"] as const).map((f) => (
              <label key={f} className="flex items-start gap-2 text-sm text-on-surface">
                <input
                  type="radio"
                  name={`${formId}-format`}
                  value={f}
                  checked={format === f}
                  disabled={isEdit}
                  onChange={() => setFormat(f)}
                  className="mt-1 accent-primary"
                />
                <span>
                  {WEBHOOK_FORMAT_LABEL[f]}
                  <span className="block text-meta text-on-surface-variant">
                    {f === "STANDARD"
                      ? "A signed JSON request. You get a secret to check the signature."
                      : "A plain chat message for a Google Chat space. No signature."}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {isEdit && (
            <p className="mt-1.5 text-meta text-on-surface-variant">The format is fixed once the webhook exists.</p>
          )}
        </fieldset>

        {isEdit && (
          <p className="text-sm text-on-surface">
            <span className="mb-1 block text-label-caps uppercase text-on-surface-variant">Current target</span>
            <span className="break-all font-mono text-meta" data-testid="webhook-current-target">
              {webhook.urlPreview}
            </span>
          </p>
        )}
        <Field label={isEdit ? "New URL" : "URL"}>
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={
              format === "GOOGLE_CHAT" ? "https://chat.googleapis.com/v1/spaces/…" : "https://example.com/hooks/solvro"
            }
            className={`${INPUT_CLASS} font-mono`}
          />
          {isEdit && <span className="mt-1 block text-meta text-on-surface-variant">Leave blank to keep the current URL.</span>}
        </Field>

        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-label-caps uppercase text-on-surface-variant">Events</legend>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {WEBHOOK_EVENT_TYPES.map((t) => (
              <CheckRow
                key={t}
                checked={events.includes(t)}
                onChange={(on) => toggleEvent(t, on)}
                label={WEBHOOK_EVENT_LABEL[t]}
              />
            ))}
          </div>
          <p className="mt-1.5 text-meta text-on-surface-variant">
            “Comment added” sends the first 500 characters of the comment.
            {format === "GOOGLE_CHAT" &&
              " A shared chat space can include people who cannot open these projects, and they will read this text."}
          </p>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-label-caps uppercase text-on-surface-variant">Projects</legend>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm text-on-surface">
              <input
                type="radio"
                name={`${formId}-scope`}
                checked={scope === "all"}
                onChange={() => setScope("all")}
                className="accent-primary"
              />
              Every project I can see
            </label>
            <label className="flex items-center gap-2 text-sm text-on-surface">
              <input
                type="radio"
                name={`${formId}-scope`}
                checked={scope === "selected"}
                onChange={() => setScope("selected")}
                className="accent-primary"
              />
              Only these projects
            </label>
          </div>
          {scope === "selected" && (
            <div className="mt-2">
              <div
                role="group"
                aria-label="Projects"
                className="max-h-48 space-y-1 overflow-y-auto rounded-sm border border-outline-variant bg-surface-container-lowest p-2"
              >
                {projectsLoading ? (
                  <TableSkeleton rows={3} columns={1} />
                ) : sortedProjects.length === 0 ? (
                  <p className="text-sm text-on-surface-variant">No projects to pick from yet.</p>
                ) : (
                  sortedProjects.map((p) => {
                    const checked = projectIds.includes(p.id);
                    return (
                      <CheckRow
                        key={p.id}
                        checked={checked}
                        disabled={!checked && projectIds.length >= WEBHOOK_MAX_PROJECTS}
                        onChange={(on) => toggleProject(p.id, on)}
                        label={p.name}
                      />
                    );
                  })
                )}
              </div>
              <p className="mt-1 text-meta text-on-surface-variant">
                {projectIds.length} of {WEBHOOK_MAX_PROJECTS} selected
              </p>
            </div>
          )}
        </fieldset>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </form>
    </Modal>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="[@media(pointer:coarse)]:min-h-11 flex items-center gap-2 py-0.5 text-sm text-on-surface">
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
      <span className="min-w-0 break-words">{label}</span>
    </label>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-label-caps uppercase text-on-surface-variant">{label}</span>
      {children}
    </label>
  );
}
