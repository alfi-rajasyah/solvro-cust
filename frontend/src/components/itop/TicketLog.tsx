// Public/Private log tabs + "Add a log entry" composer for TicketPanel.tsx
// (Task 5.4, docs/archive/plans/itop-integration.md). Entries render in the
// order the backend returns them ("newest last" per the API contract, same
// reading order as a chat thread) — this component never reorders them.
import { useId, useState, type FormEvent } from "react";
import { fmtDateTime } from "@/lib/formatDate";
import type { ItopTicketLogEntry } from "@/lib/queries";

type LogVisibility = "public" | "private";

const LOG_MAX_LENGTH = 4000;

const PILL_BASE =
  "rounded-full px-2.5 py-1 font-display text-meta font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

function pillClass(active: boolean): string {
  return [
    PILL_BASE,
    active
      ? "bg-primary text-on-primary"
      : "border border-outline-variant text-on-surface-variant hover:text-on-surface",
  ].join(" ");
}

export function TicketLog({
  publicLog,
  privateLog,
  canAct,
  onAdd,
  adding,
  error,
}: {
  publicLog: ItopTicketLogEntry[];
  privateLog: ItopTicketLogEntry[];
  /** Whether the "Add a log entry" composer should render at all. */
  canAct: boolean;
  onAdd: (visibility: LogVisibility, text: string) => void;
  adding: boolean;
  error: string | null;
}) {
  const [tab, setTab] = useState<LogVisibility>("public");
  const [entryVisibility, setEntryVisibility] = useState<LogVisibility>("public");
  const [text, setText] = useState("");
  // Complete tab semantics (fix round, phase review): each tab button owns
  // an id the shared panel points back to via `aria-labelledby`, and the
  // panel's own id is what `aria-controls` on the tabs points to.
  const baseId = useId();
  const publicTabId = `${baseId}-tab-public`;
  const privateTabId = `${baseId}-tab-private`;
  const panelId = `${baseId}-panel`;

  const entries = tab === "public" ? publicLog : privateLog;
  // Matches the backend's own limit (POST /itop/tickets/:id/log) — the
  // remaining-characters hint only shows up once it's actually relevant.
  const remaining = LOG_MAX_LENGTH - text.length;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || adding) return;
    onAdd(entryVisibility, trimmed);
    setText("");
  }

  return (
    <div>
      <div className="flex items-center gap-1.5" role="tablist" aria-label="Ticket log">
        <button
          type="button"
          role="tab"
          id={publicTabId}
          aria-selected={tab === "public"}
          aria-controls={panelId}
          onClick={() => setTab("public")}
          className={pillClass(tab === "public")}
        >
          Public
        </button>
        <button
          type="button"
          role="tab"
          id={privateTabId}
          aria-selected={tab === "private"}
          aria-controls={panelId}
          onClick={() => setTab("private")}
          className={pillClass(tab === "private")}
        >
          Private
        </button>
      </div>

      <ul
        id={panelId}
        role="tabpanel"
        aria-labelledby={tab === "public" ? publicTabId : privateTabId}
        className="mt-3 space-y-2.5"
      >
        {entries.length === 0 && (
          <li className="text-[13px] text-on-surface-variant">
            No {tab} log entries yet.
          </li>
        )}
        {entries.map((entry, i) => (
          <li
            key={i}
            className="rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2"
          >
            <div className="mb-0.5 flex items-center justify-between gap-2 text-[12px] text-on-surface-variant">
              <span className="min-w-0 truncate font-medium text-on-surface">
                {entry.author ?? "—"}
              </span>
              <span className="shrink-0">
                {fmtDateTime(entry.date)}
              </span>
            </div>
            <p className="whitespace-pre-wrap wrap-break-word text-sm text-on-surface">
              {entry.message}
            </p>
          </li>
        ))}
      </ul>

      {canAct && (
        <form onSubmit={handleSubmit} className="mt-3 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a log entry…"
            rows={2}
            maxLength={LOG_MAX_LENGTH}
            aria-label="New log entry"
            className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-hidden"
          />
          {remaining < 200 && (
            <p className="text-xs text-on-surface-variant">
              {remaining} character{remaining === 1 ? "" : "s"} left
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-pressed={entryVisibility === "public"}
                onClick={() => setEntryVisibility("public")}
                className={pillClass(entryVisibility === "public")}
              >
                Public
              </button>
              <button
                type="button"
                aria-pressed={entryVisibility === "private"}
                onClick={() => setEntryVisibility("private")}
                className={pillClass(entryVisibility === "private")}
              >
                Private
              </button>
            </div>
            <button
              type="submit"
              disabled={adding || !text.trim()}
              className="rounded-sm bg-primary px-3 py-1 font-display text-xs font-semibold text-on-primary hover:bg-primary-container disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add entry"}
            </button>
          </div>
          {error && <p className="text-[12px] text-error">{error}</p>}
        </form>
      )}
    </div>
  );
}
