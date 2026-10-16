import { Link } from "react-router-dom";
import {
  useOutlineConfig,
  useProjectOutlineMentions,
  useTaskOutlineMentions,
} from "@/lib/queries";
import {
  PROJECT_MENTIONS_HELP,
  TASK_MENTIONS_HELP,
  hiddenPagesCopy,
  mentionsTotal,
  unconnectedAction,
  unconnectedLead,
} from "@/lib/outlineMentions";
import { safeOutlineHref } from "@/lib/outlineUrl";

// "Mentioned in Outline" - the Outline pages that link to this task or project
// (docs/archive/plans/outline-integration.md, D4/D5). The server decides what a
// viewer may see with the viewer's OWN Outline account: a page the viewer cannot
// open is only ever counted, never named. A viewer without an Outline connection
// gets just the count and a way to connect.

const HEADING = "font-display text-label-caps uppercase text-on-surface-variant";

type Scope = { kind: "task" | "project"; id: number };

export function OutlineMentions({
  scope,
  variant,
}: {
  scope: Scope;
  /** `block` sits inside the task panel; `card` is a bordered panel on the project Overview. */
  variant: "block" | "card";
}) {
  // No Outline address, no requests (and no section).
  const { data: config } = useOutlineConfig();
  const addressSet = Boolean(config?.baseUrl);
  const task = useTaskOutlineMentions(scope.kind === "task" ? scope.id : 0, addressSet && scope.kind === "task");
  const project = useProjectOutlineMentions(
    scope.kind === "project" ? scope.id : 0,
    addressSet && scope.kind === "project",
  );
  const { data, isError } = scope.kind === "task" ? task : project;

  // Quiet while loading and when Outline cannot be reached: this is a side panel,
  // not something to nag about.
  if (!addressSet || !data || isError) return null;

  const total = mentionsTotal(data);
  const help = scope.kind === "task" ? TASK_MENTIONS_HELP : PROJECT_MENTIONS_HELP;
  const visible = data.connected ? (data.visible ?? []) : [];
  const hiddenCount = data.connected ? (data.hiddenCount ?? 0) : 0;

  const body = (
    <>
      <p className={HEADING}>Mentioned in Outline · {total}</p>
      {total > 0 && !data.connected && (
        <p className="mt-1.5 text-xs text-on-surface-variant" data-testid="outline-mentions-unconnected">
          {unconnectedLead(total)}
          <Link to="/settings" className="font-semibold text-primary hover:underline">
            {unconnectedAction(total)}
          </Link>
        </p>
      )}
      {(visible.length > 0 || hiddenCount > 0) && (
        <ul className="mt-1.5 space-y-0.5" data-testid="outline-mentions-list">
          {visible.map((doc) => {
            const href = safeOutlineHref(doc.url);
            const label = (
              <>
                <span className="material-symbols-outlined text-base text-on-surface-variant" aria-hidden="true">
                  description
                </span>
                <span className="min-w-0 flex-1 truncate">{doc.title || "Untitled"}</span>
              </>
            );
            return (
              <li key={doc.docId}>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-xs text-on-surface outline-hidden hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    {label}
                    <span className="material-symbols-outlined text-base text-on-surface-variant" aria-hidden="true">
                      open_in_new
                    </span>
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : (
                  <span className="flex items-center gap-2 px-1.5 py-1 text-xs text-on-surface">{label}</span>
                )}
              </li>
            );
          })}
          {hiddenCount > 0 && (
            <li
              className="flex items-center gap-2 px-1.5 py-1 text-xs text-on-surface-variant"
              data-testid="outline-mentions-hidden"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                lock
              </span>
              {hiddenPagesCopy(hiddenCount)}
            </li>
          )}
        </ul>
      )}
      <p className="mt-1.5 text-meta text-on-surface-variant">{help}</p>
    </>
  );

  return variant === "card" ? (
    <section
      className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4"
      data-testid="outline-mentions"
    >
      {body}
    </section>
  ) : (
    <div className="mt-4" data-testid="outline-mentions">
      {body}
    </div>
  );
}
