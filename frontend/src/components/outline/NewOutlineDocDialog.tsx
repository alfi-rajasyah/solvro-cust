// "New doc" from the Docs tab: pick a template (or a blank page), a title, where
// to place it under the linked Outline page/collection, and whether to publish.
// The page is created in Outline AS THE SIGNED-IN USER (their own OAuth token, D2)
// and opened in a new tab (docs/archive/plans/outline-integration.md, B6).
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/components/Modal";
import { ApiError } from "@/lib/api";
import {
  defaultDocTitle,
  defaultPlaceValue,
  OUTLINE_DOC_TITLE_MAX,
  placeUnderOptions,
} from "@/lib/outlineDocs";
import { safeOutlineHref } from "@/lib/outlineUrl";
import {
  queryKeys,
  useCreateOutlineDoc,
  useOutlineMe,
  useOutlineTemplates,
  type OutlineDocNode,
  type OutlineDocsScope,
} from "@/lib/queries";

export interface NewDocAnchor {
  kind: "doc" | "collection";
  title: string;
}

const BLANK = "";

function isNotConnectedCode(body: unknown): boolean {
  const code = typeof body === "object" && body !== null ? (body as { code?: unknown }).code : null;
  return code === "outline_not_connected" || code === "outline_reconnect_required";
}

export function NewOutlineDocDialog({
  open,
  onClose,
  scope,
  id,
  anchor,
  tree,
}: {
  open: boolean;
  onClose: () => void;
  scope: OutlineDocsScope;
  id: number;
  anchor: NewDocAnchor;
  tree: OutlineDocNode[];
}) {
  const formId = useId();
  const { data: me } = useOutlineMe();
  const templates = useOutlineTemplates(open);
  const create = useCreateOutlineDoc(scope, id);
  const qc = useQueryClient();
  const fallbackLink = useRef<HTMLAnchorElement>(null);

  const places = useMemo(() => placeUnderOptions(anchor, tree), [anchor, tree]);
  const [templateId, setTemplateId] = useState(BLANK);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [place, setPlace] = useState(defaultPlaceValue(anchor, tree));
  const [publish, setPublish] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  // Fresh form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setTemplateId(BLANK);
    setTitle(defaultDocTitle(null));
    setTitleTouched(false);
    setPlace(defaultPlaceValue(anchor, tree));
    setPublish(true);
    setError(null);
    setCreatedUrl(null);
    // Reset only on open; tree/anchor refreshes must not wipe a half-filled form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // When the browser refused the new tab, the fallback link is the way forward:
  // put the keyboard on it.
  useEffect(() => {
    if (createdUrl) fallbackLink.current?.focus();
  }, [createdUrl]);

  function chooseTemplate(next: string) {
    setTemplateId(next);
    if (!titleTouched) {
      const t = templates.data?.find((x) => x.id === next)?.title ?? null;
      setTitle(defaultDocTitle(t));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Enter a title.");
      return;
    }
    try {
      const created = await create.mutateAsync({
        title: trimmed,
        publish,
        ...(templateId !== BLANK ? { templateId } : {}),
        ...(place !== "" ? { parentDocumentId: place } : {}),
      });
      const href = safeOutlineHref(created.url);
      if (!href) {
        onClose();
        return;
      }
      // Popup blockers may refuse a tab opened after an await; the success note
      // below keeps a real link in that case. NOT the "noopener" window feature:
      // it makes window.open return null even when the tab opened, which would
      // look like a blocked popup and leave the dialog open. Sever the opener by
      // hand instead.
      const opened = window.open(href, "_blank");
      if (opened) {
        opened.opener = null;
        onClose();
      } else {
        setCreatedUrl(href);
      }
    } catch (err) {
      // The connection is gone (disconnected elsewhere, token refused): refresh
      // what the Docs tab and Settings believe so the tab switches to "Connect".
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        isNotConnectedCode(err.body)
      ) {
        void qc.invalidateQueries({ queryKey: queryKeys.outlineMe });
        void qc.invalidateQueries({ queryKey: queryKeys.outlineDocs(scope, id) });
      }
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not create the page in Outline. Try again.",
      );
    }
  }

  const busy = create.isPending;
  const inputClass =
    "w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";
  const labelClass =
    "mb-1 block font-display text-label-caps uppercase text-on-surface-variant";

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="New Outline doc"
      widthClass="max-w-2xl"
      footer={
        createdUrl ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-outline-variant px-4 py-1.5 font-display text-xs font-semibold text-on-surface hover:bg-surface-container"
          >
            Close
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-sm border border-outline-variant px-4 py-1.5 font-display text-xs font-semibold text-on-surface hover:bg-surface-container disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form={formId}
              disabled={busy || title.trim() === ""}
              data-testid="new-outline-doc-submit"
              className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-semibold text-on-primary hover:bg-primary-container disabled:opacity-60"
            >
              {busy ? "Creating…" : "Create and open"}
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                open_in_new
              </span>
            </button>
          </>
        )
      }
    >
      {createdUrl ? (
        <div className="space-y-3 text-sm text-on-surface" data-testid="new-outline-doc-created">
          <p>The page was created in Outline.</p>
          <a
            ref={fallbackLink}
            href={createdUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Open it in Outline
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              open_in_new
            </span>
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
      ) : (
        <form id={formId} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded-sm border border-error/40 bg-error/10 px-3 py-2 text-sm text-error"
            >
              {error}
            </div>
          )}

          <fieldset>
            <legend className={labelClass}>Template — from your Outline</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TemplateCard
                checked={templateId === BLANK}
                onSelect={() => chooseTemplate(BLANK)}
                title="Blank page"
                hint="No template"
              />
              {(templates.data ?? []).map((t) => (
                <TemplateCard
                  key={t.id}
                  checked={templateId === t.id}
                  onSelect={() => chooseTemplate(t.id)}
                  title={t.title}
                />
              ))}
            </div>
            {templates.isLoading && (
              <p className="mt-2 text-xs text-on-surface-variant">Loading your templates…</p>
            )}
            {templates.isError && (
              <p className="mt-2 text-xs text-on-surface-variant">
                Could not load your Outline templates. You can still create a blank page.
              </p>
            )}
          </fieldset>

          <div>
            <label htmlFor={`${formId}-title`} className={labelClass}>
              Title<span className="ml-1 text-error">*</span>
            </label>
            <input
              id={`${formId}-title`}
              type="text"
              value={title}
              maxLength={OUTLINE_DOC_TITLE_MAX}
              autoFocus
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleTouched(true);
              }}
              data-testid="new-outline-doc-title"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor={`${formId}-place`} className={labelClass}>
              Place under
            </label>
            <select
              id={`${formId}-place`}
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              data-testid="new-outline-doc-place"
              className={inputClass}
            >
              {places.map((o) => (
                <option key={o.value || "top"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-start gap-2 text-sm text-on-surface-variant">
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span>Publish now (otherwise it stays a draft only you can see)</span>
          </label>

          <p className="flex items-center gap-1.5 text-xs text-on-surface-variant">
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              person
            </span>
            <span>
              Created in Outline as{" "}
              <strong className="font-semibold text-on-surface" data-testid="new-outline-doc-as">
                {me?.outlineEmail ?? "your Outline account"}
              </strong>{" "}
              — your own Outline account.
            </span>
          </p>
        </form>
      )}
    </Modal>
  );
}

function TemplateCard({
  checked,
  onSelect,
  title,
  hint,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  hint?: string;
}) {
  return (
    <label
      className={[
        "flex cursor-pointer items-start gap-2.5 rounded-sm border px-3 py-2.5",
        checked ? "border-primary bg-primary/10" : "border-outline-variant hover:border-primary/40",
      ].join(" ")}
    >
      <input
        type="radio"
        name="outline-template"
        checked={checked}
        onChange={onSelect}
        className="mt-1 accent-primary"
      />
      <span>
        <span className="block font-display text-sm font-semibold text-on-surface">{title}</span>
        {hint && <span className="block text-xs text-on-surface-variant">{hint}</span>}
      </span>
    </label>
  );
}
