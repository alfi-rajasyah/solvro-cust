import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { ApiError, apiDownloadBlob } from "@/lib/api";
import { fmtDateTime } from "@/lib/formatDate";
import {
  useAttachmentConfig,
  useDeleteAttachment,
  useTaskAttachments,
  useUploadAttachment,
  type AttachmentConfig,
  type TaskAttachment,
} from "@/lib/queries";
import { ConfirmModal } from "./ConfirmModal";

const MB = 1024 * 1024;

/** `1.4 MB`, `820 KB`, `12 B`: binary units, one decimal from MB up. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / MB;
  return `${mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Decimal MB the way the server words its limit messages (`formatMb` in
 * backend/src/routes/attachments.ts), so a limit such as 1.5 MB reads the same
 * in the help line, the pre-check and the server's answer.
 */
export function formatMb(bytes: number): string {
  const mb = bytes / MB;
  return `${Number.isInteger(mb) ? mb : Number(mb.toFixed(2))} MB`;
}

/** Every limit as one line the user reads before picking files. */
export function limitsText(c: AttachmentConfig): string {
  return `Up to ${formatMb(c.maxFileBytes)} per file, ${c.maxFilesPerTask} files and ${formatMb(c.maxTaskBytes)} per task. Types: ${c.allowedExtensions.join(", ")}.`;
}

const sizeMessage = (c: AttachmentConfig) => `Files can be up to ${formatMb(c.maxFileBytes)}.`;
const typeMessage = (c: AttachmentConfig) =>
  `This file type is not allowed. Allowed types: ${c.allowedExtensions.join(", ")}.`;
const countMessage = (c: AttachmentConfig) => `A task can have up to ${c.maxFilesPerTask} files.`;
const totalMessage = (c: AttachmentConfig) =>
  `A task's files can total up to ${formatMb(c.maxTaskBytes)}.`;

/**
 * Checks one file against the limits before any bytes are sent. `count` and
 * `bytes` are what the task holds right now, including files from this same
 * pick that already went up. Returns the message to show, or null.
 */
export function precheckFile(
  file: { name: string; size: number },
  config: AttachmentConfig,
  held: { count: number; bytes: number },
): string | null {
  if (!config.allowedExtensions.includes(extensionOf(file.name))) return typeMessage(config);
  if (file.size > config.maxFileBytes) return sizeMessage(config);
  if (held.count >= config.maxFilesPerTask) return countMessage(config);
  if (held.bytes + file.size > config.maxTaskBytes) return totalMessage(config);
  return null;
}

/**
 * An nginx 413 answers with an HTML page, not the API's JSON, so the message
 * would read "Request failed with status 413". Say what happened instead.
 */
export function uploadErrorMessage(err: unknown, config: AttachmentConfig | undefined): string {
  if (err instanceof ApiError) {
    const jsonBody = typeof err.body === "object" && err.body !== null;
    if (err.status === 413 && !jsonBody) {
      return config ? sizeMessage(config) : "This file is larger than the server accepts.";
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "The upload failed.";
}

interface QueueRow {
  key: number;
  name: string;
  status: "uploading" | "error";
  percent: number;
  error?: string;
}

let nextKey = 1;

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

const iconButton =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface disabled:opacity-50 outline-hidden focus-visible:ring-2 focus-visible:ring-primary [@media(pointer:coarse)]:size-11";

/**
 * Files attached to a task: list, download, and (with task:write) upload and
 * delete. Files go up one request at a time (D5 in
 * docs/archive/plans/task-attachments.md): the server checks the per-task limits
 * once per file, so one rejected file never cancels the rest of the pick.
 */
export function TaskAttachments({ taskId, canEdit }: { taskId: number; canEdit: boolean }) {
  const { data: config, isError: configError, refetch: refetchConfig } = useAttachmentConfig();
  const { data: items, isLoading, isError, error } = useTaskAttachments(taskId);
  const upload = useUploadAttachment(taskId);
  const remove = useDeleteAttachment(taskId);

  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [pendingDelete, setPendingDelete] = useState<TaskAttachment | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  // Every in-flight upload pick and download, aborted when the section unmounts.
  const controllers = useRef(new Set<AbortController>());
  useEffect(() => {
    const live = controllers.current;
    return () => {
      for (const c of live) c.abort();
      live.clear();
    };
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const patchRow = (key: number, patch: Partial<QueueRow>) =>
    setQueue((q) => q.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const dropRow = (key: number) => setQueue((q) => q.filter((r) => r.key !== key));

  async function uploadAll(files: File[]) {
    if (!config) return;
    const held = {
      count: (items ?? []).length,
      bytes: (items ?? []).reduce((sum, a) => sum + a.sizeBytes, 0),
    };
    const pick = new AbortController();
    controllers.current.add(pick);
    for (const file of files) {
      if (pick.signal.aborted) break;
      const key = nextKey++;
      const problem = precheckFile(file, config, held);
      if (problem) {
        setQueue((q) => [...q, { key, name: file.name, status: "error", percent: 0, error: problem }]);
        continue;
      }
      setQueue((q) => [...q, { key, name: file.name, status: "uploading", percent: 0 }]);
      try {
        await upload.mutateAsync({
          file,
          signal: pick.signal,
          onProgress: (p) => patchRow(key, { percent: p.total ? Math.round((p.loaded / p.total) * 100) : 0 }),
        });
        held.count += 1;
        held.bytes += file.size;
        dropRow(key);
      } catch (err) {
        if (isAbort(err) || pick.signal.aborted) break;
        patchRow(key, { status: "error", error: uploadErrorMessage(err, config) });
      }
    }
    controllers.current.delete(pick);
  }

  async function download(a: TaskAttachment) {
    setDownloadError(null);
    const ctl = new AbortController();
    controllers.current.add(ctl);
    setDownloadingId(a.id);
    try {
      saveBlob(await apiDownloadBlob(`/attachments/${a.id}`, ctl.signal), a.fileName);
    } catch (err) {
      if (!isAbort(err)) setDownloadError(`Could not download ${a.fileName}: ${(err as Error).message}`);
    } finally {
      controllers.current.delete(ctl);
      if (!ctl.signal.aborted) setDownloadingId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(pendingDelete.id);
      setPendingDelete(null);
      // The row that held focus is gone: land on the Attach button, or the heading for a read-only viewer.
      requestAnimationFrame(() => (attachRef.current ?? headingRef.current)?.focus());
    } catch (err) {
      setPendingDelete(null);
      setDeleteError(`Could not delete ${pendingDelete.fileName}: ${(err as Error).message}`);
    }
  }

  const accept = config ? config.allowedExtensions.map((e) => `.${e}`).join(",") : undefined;
  const busy = queue.some((r) => r.status === "uploading");

  return (
    <section aria-labelledby={`attachments-h-${taskId}`} className="space-y-3">
      <h2
        id={`attachments-h-${taskId}`}
        ref={headingRef}
        tabIndex={-1}
        className="font-display text-label-caps uppercase text-on-surface-variant outline-hidden"
      >
        Attachments {items && items.length > 0 && `· ${items.length}`}
      </h2>

      {canEdit && (
        <div className="space-y-1">
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept={accept}
            aria-label="Choose files to attach"
            data-testid="attachment-input"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) void uploadAll(files);
            }}
          />
          <button
            ref={attachRef}
            type="button"
            disabled={!config}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-sm border border-outline-variant px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-surface-container disabled:opacity-50 focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 [@media(pointer:coarse)]:min-h-11"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              attach_file
            </span>
            Attach files
          </button>
          {config && <p className="text-meta text-on-surface-variant">{limitsText(config)}</p>}
          {configError && !config && (
            <p className="flex flex-wrap items-center gap-x-2 text-meta text-on-surface-variant">
              Could not load the upload limits.
              <button
                type="button"
                onClick={() => void refetchConfig()}
                className="rounded-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                Retry
              </button>
            </p>
          )}
        </div>
      )}

      {queue.length > 0 && (
        <ul className="space-y-1.5" aria-label="Uploads">
          {queue.map((r) => (
            <li
              key={r.key}
              className="rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-xs"
            >
              {r.status === "uploading" ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-on-surface" title={r.name}>
                      {r.name}
                    </span>
                    <span className="shrink-0 text-meta text-on-surface-variant">{r.percent}%</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={`Uploading ${r.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={r.percent}
                    className="h-1 overflow-hidden rounded-full bg-surface-container-high"
                  >
                    <div className="h-full bg-primary" style={{ width: `${r.percent}%` }} />
                  </div>
                </div>
              ) : (
                <div role="alert" className="flex items-start gap-2">
                  <span className="material-symbols-outlined shrink-0 text-base text-error" aria-hidden="true">
                    error
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-on-surface" title={r.name}>
                      {r.name}
                    </p>
                    <p className="break-words text-meta text-error">{r.error}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Dismiss error for ${r.name}`}
                    onClick={() => dropRow(r.key)}
                    className={iconButton}
                  >
                    <span className="material-symbols-outlined text-base" aria-hidden="true">
                      close
                    </span>
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {(downloadError || deleteError) && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{downloadError ?? deleteError}</AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <div className="h-12 animate-pulse rounded-sm border border-outline-variant bg-surface-container-low" />
      )}

      {isError && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">
            Could not load attachments: {(error as Error).message}
          </AlertDescription>
        </Alert>
      )}

      {items && items.length === 0 && queue.length === 0 && (
        <p className="text-xs text-on-surface-variant">No files yet.</p>
      )}

      {items && items.length > 0 && (
        <ul className="divide-y divide-outline-variant rounded-sm border border-outline-variant bg-surface-container-lowest">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-on-surface" title={a.fileName}>
                  {a.fileName}
                </p>
                <p className="truncate text-meta text-on-surface-variant">
                  {[formatBytes(a.sizeBytes), a.uploadedBy?.name, fmtDateTime(a.createdAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <button
                type="button"
                aria-label={downloadingId === a.id ? `Downloading ${a.fileName}` : `Download ${a.fileName}`}
                aria-busy={downloadingId === a.id}
                disabled={downloadingId === a.id}
                onClick={() => void download(a)}
                className={iconButton}
              >
                <span
                  className={`material-symbols-outlined text-base ${downloadingId === a.id ? "animate-spin motion-reduce:animate-none" : ""}`}
                  aria-hidden="true"
                >
                  {downloadingId === a.id ? "progress_activity" : "download"}
                </span>
              </button>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Delete ${a.fileName}`}
                  onClick={() => setPendingDelete(a)}
                  className={iconButton}
                >
                  <span className="material-symbols-outlined text-base" aria-hidden="true">
                    delete
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmModal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title="Delete this file?"
        body={
          <p className="break-words text-sm text-on-surface-variant">
            {pendingDelete?.fileName} will be removed from the task. This cannot be undone.
          </p>
        }
        confirmLabel="Delete file"
        confirmTone="danger"
        busy={remove.isPending}
      />
      <span className="sr-only" aria-live="polite">
        {busy ? "Uploading files" : ""}
      </span>
    </section>
  );
}
