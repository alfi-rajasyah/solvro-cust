import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { ConfirmModal } from "@/components/ConfirmModal";
import { DateField } from "@/components/DateField";
import { ProjectStatusChip } from "@/components/StatusChip";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { dateToDay, formatDisplay } from "@/lib/dateField";
import { useGanttExport } from "@/lib/gantt/exportContext";
import { type ProjectDetail as ProjectDetailType, useLockBaseline } from "@/lib/queries";

interface RightSidebarProps {
  project: ProjectDetailType;
  open: boolean;
  onClose: () => void;
}

export function RightSidebar({ project, open, onClose }: RightSidebarProps) {
  const { handlers: exportHandlers } = useGanttExport();
  const [exporting, setExporting] = useState<"excel" | "pdf" | "pdfTab" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Baseline lock / reset flow — moved here from the Gantt toolbar
  // (gantt-v2/SolvroGantt.tsx) on 2026-08-31: a once-per-project action
  // that was costing the toolbar ~105px. Gated on `project:write`, which is
  // what POST /projects/:id/baseline requires (backend/src/routes/projects.ts).
  const { user } = useAuth();
  const canLockBaseline = hasPermission(user, "project:write");
  const lockBaseline = useLockBaseline(project.id);
  const [confirmingBaseline, setConfirmingBaseline] = useState(false);
  const [baselineAsOf, setBaselineAsOf] = useState<string>("");
  const [baselineNotice, setBaselineNotice] = useState<string | null>(null);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  useEffect(() => {
    if (!baselineNotice) return;
    const t = setTimeout(() => setBaselineNotice(null), 4000);
    return () => clearTimeout(t);
  }, [baselineNotice]);
  useEffect(() => {
    if (confirmingBaseline) {
      setBaselineAsOf(dateToDay(new Date()) ?? "");
    }
  }, [confirmingBaseline]);
  const baselineLockedAtPretty = project.baselineLockedAt
    ? new Date(project.baselineLockedAt).toLocaleString()
    : null;
  const baselineLockedAtDay = project.baselineLockedAt
    ? new Date(project.baselineLockedAt).toLocaleDateString()
    : null;

  // Closed panel = `inert`: it only slides off-screen (translate-x-full), so
  // without this its buttons stay in the tab order while aria-hidden — and
  // "Lock baseline" would open a modal from an invisible panel. Set through
  // the DOM because React 18 has no boolean `inert` prop (`inert={false}`
  // renders the attribute, which is truthy).
  const asideRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    asideRef.current?.toggleAttribute("inert", !open);
  }, [open]);

  async function runExport(kind: "excel" | "pdf" | "pdfTab") {
    if (!exportHandlers || exporting) return;
    setExportError(null);
    setExporting(kind);
    // Open the tab synchronously inside the click's user activation —
    // opening after the async export work would be pop-up-blocked.
    const win = kind === "pdfTab" ? window.open("", "_blank") : null;
    try {
      if (kind === "pdfTab") await exportHandlers.pdfTab(win);
      else await exportHandlers[kind]();
    } catch (err) {
      win?.close();
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <>
      {open && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close project context"
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] md:hidden"
        />
      )}
      <aside
      ref={asideRef}
      aria-hidden={!open}
      className={[
        "fixed right-0 top-14 bottom-0 z-40 w-full transform border-l border-outline-variant bg-surface-container-low/95 font-display backdrop-blur-md transition-transform duration-200 ease-out md:z-30 md:w-context-panel",
        open ? "translate-x-0" : "translate-x-full",
      ].join(" ")}
    >
      <div className="flex items-center justify-between border-b border-outline-variant px-5 py-4">
        <span className="font-display text-label-caps uppercase tracking-widest text-on-surface-variant">
          Project context
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close project context"
          className="flex h-7 w-7 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-base">close</span>
        </button>
      </div>

      <div className="space-y-6 overflow-y-auto px-5 py-5">
        <section>
          <div className="flex items-center gap-3">
            <ProjectStatusChip status={project.status} />
          </div>
          <h2 className="mt-2 truncate font-display text-base font-semibold text-on-surface">
            {project.name}
          </h2>
          {project.description && (
            <p className="mt-1 text-xs text-on-surface-variant">
              {project.description}
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-2 font-display text-label-caps uppercase tracking-widest text-on-surface-variant">
            Stakeholders
          </h3>
          <dl className="space-y-1.5 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-on-surface-variant">TAM</dt>
              <dd className="font-medium text-on-surface">{project.tam.username}</dd>
            </div>
            {project.customer && (
              <div className="flex justify-between">
                <dt className="text-on-surface-variant">Customer</dt>
                <dd>
                  <Link
                    to={`/customers/${project.customer.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {project.customer.name}
                  </Link>
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-on-surface-variant">Tasks</dt>
              <dd className="font-medium text-on-surface">{project._count.tasks}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h3 className="mb-2 font-display text-label-caps uppercase tracking-widest text-on-surface-variant">
            Baseline
          </h3>
          <dl className="space-y-1.5 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">Locked</dt>
              <dd className="text-right font-medium text-on-surface">
                {baselineLockedAtDay
                  ? `${baselineLockedAtDay}${project.baselineLockedBy ? ` · ${project.baselineLockedBy.username}` : ""}`
                  : "Not yet"}
              </dd>
            </div>
          </dl>
          {canLockBaseline && (
            <button
              type="button"
              onClick={() => setConfirmingBaseline(true)}
              disabled={lockBaseline.isPending}
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-sm border border-outline-variant bg-surface-container-lowest px-2.5 py-2 font-display text-[12px] font-semibold text-on-surface transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[17px]" aria-hidden="true">
                {project.baselineLockedAt ? "bookmark" : "bookmark_add"}
              </span>
              {project.baselineLockedAt ? "Reset baseline" : "Lock baseline"}
            </button>
          )}
          <p className="mt-2 text-[11px] text-on-surface-variant">
            {project.baselineLockedAt
              ? "Ghost bars show the locked dates — toggle them from the Gantt toolbar's Baseline button."
              : "Snapshot every task's dates so later slips can be measured against them."}
          </p>
          {baselineNotice && (
            <p
              role="status"
              className="mt-2 flex items-center gap-1 text-[12px] font-semibold text-primary"
            >
              <span className="material-symbols-outlined text-[15px]">check_circle</span>
              {baselineNotice}
            </p>
          )}
          {baselineError && (
            <Alert variant="destructive" className="mt-2">
              <AlertDescription className="text-xs">{baselineError}</AlertDescription>
            </Alert>
          )}
        </section>

        {exportHandlers && (
          <section>
            <h3 className="mb-2 font-display text-label-caps uppercase tracking-widest text-on-surface-variant">
              Export schedule
            </h3>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => runExport("excel")}
                disabled={exporting !== null}
                className="inline-flex items-center justify-center gap-1.5 rounded-sm border border-outline-variant bg-surface-container-lowest px-2.5 py-2 font-display text-[12px] font-semibold text-on-surface transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[17px]">
                  table_view
                </span>
                {exporting === "excel" ? "Exporting…" : "Excel"}
              </button>
              <button
                type="button"
                onClick={() => runExport("pdf")}
                disabled={exporting !== null}
                className="inline-flex items-center justify-center gap-1.5 rounded-sm border border-outline-variant bg-surface-container-lowest px-2.5 py-2 font-display text-[12px] font-semibold text-on-surface transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[17px]">
                  picture_as_pdf
                </span>
                {exporting === "pdf" ? "Exporting…" : "PDF"}
              </button>
              <button
                type="button"
                onClick={() => runExport("pdfTab")}
                disabled={exporting !== null}
                className="inline-flex items-center justify-center gap-1.5 rounded-sm border border-outline-variant bg-surface-container-lowest px-2.5 py-2 font-display text-[12px] font-semibold text-on-surface transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[17px]">
                  open_in_new
                </span>
                {exporting === "pdfTab" ? "Opening…" : "View"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-on-surface-variant">
              Excel: tasks + date grid · PDF: download · View: open the PDF in a
              tab (use when downloads hang).
            </p>
            {exportError && (
              <Alert variant="destructive" className="mt-2">
                <AlertDescription className="text-xs">{exportError}</AlertDescription>
              </Alert>
            )}
          </section>
        )}

        {project.customer && (
          <section>
            <h3 className="mb-2 font-display text-label-caps uppercase tracking-widest text-on-surface-variant">
              Documents
            </h3>
            <Link
              to={`/customers/${project.customer.id}?tab=documents`}
              className="flex items-start gap-3 rounded-sm border border-outline-variant bg-surface-container-lowest p-3 transition-colors hover:border-primary/40"
            >
              <span
                className="material-symbols-outlined text-primary"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                description
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-semibold text-on-surface">
                  Customer documents
                </p>
                <p className="mt-0.5 text-[12px] text-on-surface-variant">
                  Open the Documents resource for {project.customer.name}.
                </p>
                <span className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-primary">
                  Go to Documents
                  <span className="material-symbols-outlined text-[15px]">
                    chevron_right
                  </span>
                </span>
              </div>
            </Link>
          </section>
        )}
      </div>
    </aside>

      {/* Kept as a sibling of the panel for readability — Modal.tsx portals
          to document.body, so the <aside>'s transform never affects it.
          Body copy ported verbatim from the Gantt toolbar's dialog. */}
      <ConfirmModal
        open={confirmingBaseline}
        onClose={() => setConfirmingBaseline(false)}
        onConfirm={async () => {
          setBaselineError(null);
          try {
            const asOfIso = baselineAsOf ? new Date(`${baselineAsOf}T00:00:00`).toISOString() : undefined;
            const res = await lockBaseline.mutateAsync({ asOfDate: asOfIso });
            const stamp = res.baselineLockedAt ? new Date(res.baselineLockedAt).toLocaleDateString() : "";
            setBaselineNotice(
              project.baselineLockedAt
                ? `Baseline overwritten — now anchored to ${stamp}`
                : `Baseline locked as of ${stamp}`,
            );
          } catch (err) {
            setBaselineError(err instanceof ApiError ? err.message : "Could not lock baseline.");
          } finally {
            setConfirmingBaseline(false);
          }
        }}
        title={project.baselineLockedAt ? "Reset project baseline?" : "Lock project baseline?"}
        confirmLabel={project.baselineLockedAt ? "Overwrite baseline" : "Lock baseline"}
        confirmTone={project.baselineLockedAt ? "warning" : "primary"}
        busy={lockBaseline.isPending}
        body={
          <div className="space-y-3">
            {project.baselineLockedAt ? (
              <p>
                <strong>Overwrite the existing baseline?</strong> The previous snapshot
                {project.baselineLockedBy
                  ? ` (locked by ${project.baselineLockedBy.username} on ${baselineLockedAtPretty})`
                  : ` (locked ${baselineLockedAtPretty})`}{" "}
                will be replaced with the current schedule. This cannot be undone.
              </p>
            ) : (
              <p>
                Lock the current schedule as the official baseline for this project? Every task's
                current Start and Due dates will be saved as its baseline so future slips can be
                measured against this snapshot.
              </p>
            )}
            <label className="block">
              <span className="mb-1 block font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
                Baseline as-of date
              </span>
              <DateField
                variant="boxed"
                className="w-full px-2 py-1.5 text-xs font-body focus:ring-2 focus:ring-primary/30"
                value={baselineAsOf || null}
                onChange={(d) => setBaselineAsOf(d ?? "")}
                aria-label={
                  baselineAsOf
                    ? `Baseline as-of date, currently ${formatDisplay(baselineAsOf)}`
                    : "Baseline as-of date"
                }
              />
              <span className="mt-1 block text-[11px] text-on-surface-variant">
                Defaults to today. Use a different date to backdate the snapshot — e.g. "May 1
                baseline".
              </span>
            </label>
            {project.baselineLockedAt && (
              <div className="border-t border-outline-variant pt-2">
                <button
                  type="button"
                  disabled={lockBaseline.isPending}
                  onClick={async () => {
                    setBaselineError(null);
                    try {
                      await lockBaseline.mutateAsync({ clear: true });
                      setBaselineNotice("Baseline cleared");
                    } catch (err) {
                      setBaselineError(
                        err instanceof ApiError ? err.message : "Could not clear baseline.",
                      );
                    } finally {
                      setConfirmingBaseline(false);
                    }
                  }}
                  className="font-display text-label-caps uppercase tracking-wider text-error hover:underline disabled:opacity-50"
                >
                  Clear baseline instead
                </button>
                <span className="ml-1 text-[11px] text-on-surface-variant">
                  — removes the snapshot entirely.
                </span>
              </div>
            )}
          </div>
        }
      />
    </>
  );
}
