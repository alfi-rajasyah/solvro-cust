// Excel/CSV import dialog for the Pipeline board (PRD §2.9, M4.18). Three
// steps — upload, preview, done — mirroring the reference app's
// `ImportExcelDialog` (../VeloraApp components/import-excel-dialog.tsx,
// read-only oracle): download a client-generated template, parse the
// workbook client-side with per-row validation, then POST the valid rows
// through `useImportOpportunities` and show the server's per-row results.
//
// `xlsx` (SheetJS) is imported lazily (`await import("xlsx")`), both here
// and in `downloadTemplate` below, so the ~600KB parser never lands in the
// main bundle for users who never open this dialog — the only approved new
// frontend dependency this program introduces (root CLAUDE.md Guardrails).
//
// Errors render inline via `reui/alert.tsx` — Solvro has no toast system
// (frontend/CLAUDE.md / PRD §2.11).
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Modal } from "./Modal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import {
  extractDataRows,
  IMPORT_ROW_CAP,
  IMPORTABLE_STAGES,
  parseImportRow,
  TEMPLATE_HEADERS,
  type ParsedRow,
} from "@/components/pipeline/importParse";
import { Chip } from "@/components/StatusChip";
import { ApiError } from "@/lib/api";
import { formatIDR, type PipelineStage } from "@/lib/pipelineFormat";
import {
  useImportOpportunities,
  useUsers,
  type ImportOpportunitiesResult,
  type ImportOpportunityRow,
} from "@/lib/queries";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Step = "upload" | "preview" | "done";

/** Generates and downloads the import template workbook, client-side. */
function downloadTemplate() {
  void import("xlsx").then((XLSX) => {
    const example = [
      "Implementasi ERP",
      "PT. Maju Jaya",
      "500000000",
      "assessment",
      "",
      "30/06/2026",
      "ERP Implementation",
      "70",
      "Referral",
      "Initial meeting done, client is interested in the finance module",
    ];
    const note = [
      `* Valid stages: ${IMPORTABLE_STAGES.map((s) => s.toLowerCase()).join(", ")}`,
      "",
      "",
      "",
      "",
      "* Format: DD/MM/YYYY",
      "",
      "* Number 0-100",
      "",
      "* Optional: seeds the deal's first activity note",
    ];

    const ws = XLSX.utils.aoa_to_sheet([[...TEMPLATE_HEADERS], example, note]);
    ws["!cols"] = [
      { wch: 30 },
      { wch: 25 },
      { wch: 18 },
      { wch: 24 },
      { wch: 20 },
      { wch: 15 },
      { wch: 25 },
      { wch: 16 },
      { wch: 18 },
      { wch: 30 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Opportunities");
    XLSX.writeFile(wb, "solvro-pipeline-import-template.xlsx");
  });
}

export function PipelineImportDialog({ open, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  // N6: PIC matching (`picByUsername` in `handleFile` below) silently comes
  // up empty for every row if the file gets picked/parsed before this query
  // resolves — surfaced + gated on below rather than left implicit.
  const { data: users, isLoading: usersLoading, isError: usersError } = useUsers();
  const importMutation = useImportOpportunities();

  // S5: focused on every step transition so a screen reader announces the
  // new step (upload/preview/done) — only one of the three step containers
  // below is ever mounted at a time, so one ref/effect pair covers all
  // three.
  const stepRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [result, setResult] = useState<ImportOpportunitiesResult | null>(null);
  // The rows actually POSTed (client-valid rows, capped at IMPORT_ROW_CAP),
  // kept around so the "done" step can show title/company next to each
  // result — the server's response only echoes back `row`/`status`/`reason`
  // /`id` (backend/src/routes/opportunities.ts's ImportRowResult), not the
  // submitted fields, and `results[i]` corresponds 1:1 by array position to
  // `submittedRows[i]` since the server iterates `rows` in call order.
  const [submittedRows, setSubmittedRows] = useState<ParsedRow[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    stepRef.current?.focus();
  }, [step]);

  const reset = useCallback(() => {
    setStep("upload");
    setFileName("");
    setParsing(false);
    setParseError(null);
    setRows([]);
    setResult(null);
    setSubmittedRows([]);
    setSubmitError(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParsing(true);
    setParseError(null);
    setRows([]);

    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) throw new Error("Empty workbook");
      const ws = wb.Sheets[firstSheet];
      const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      const picByUsername = new Map<string, number>();
      for (const u of users ?? []) picByUsername.set(u.username.toLowerCase(), u.id);

      const dataRows = extractDataRows(raw);
      const parsed: ParsedRow[] = dataRows.map((r, idx) => parseImportRow(r, idx, picByUsername));

      setRows(parsed);
      setStep("preview");
    } catch {
      setParseError("Could not read the file. Make sure it's a valid .xlsx or .csv export.");
    } finally {
      setParsing(false);
      // N4: without this, re-picking the SAME file (e.g. fixed externally
      // and re-uploaded under the same name) doesn't fire another `change`
      // event — the input's value is unchanged from the browser's
      // perspective, so nothing re-triggers `handleFile`.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleImport() {
    // Capped at IMPORT_ROW_CAP — see that constant's comment. A workbook
    // with more valid rows than the cap still imports the first
    // IMPORT_ROW_CAP of them rather than failing the whole call.
    const validRows = rows.filter((r) => r.status === "valid").slice(0, IMPORT_ROW_CAP);
    if (validRows.length === 0) return;
    setSubmitError(null);

    const payload: ImportOpportunityRow[] = validRows.map((r) => ({
      title: r.title,
      customerName: r.customerName,
      dealValue: r.dealValue,
      stage: r.stage as PipelineStage,
      picId: r.picId,
      deadline: r.deadline,
      productSolution: r.productSolution || undefined,
      winProbability: r.winProbability,
      leadSource: r.leadSource || null,
      activityLog: r.activityLog || null,
    }));

    try {
      const res = await importMutation.mutateAsync(payload);
      setSubmittedRows(validRows);
      setResult(res);
      setStep("done");
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Import failed.");
    }
  }

  function handleChangeFile() {
    setRows([]);
    setParseError(null);
    setStep("upload");
    if (fileRef.current) fileRef.current.value = "";
  }

  const validCount = rows.filter((r) => r.status === "valid").length;
  const invalidCount = rows.filter((r) => r.status === "invalid").length;
  const importCount = Math.min(validCount, IMPORT_ROW_CAP);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import opportunities"
      widthClass="max-w-3xl"
      footer={
        step === "preview" ? (
          <>
            <button
              type="button"
              onClick={handleClose}
              disabled={importMutation.isPending}
              className="rounded-lg border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={validCount === 0 || importMutation.isPending}
              className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60"
            >
              {importMutation.isPending
                ? "Importing…"
                : `Import ${importCount} valid row${importCount === 1 ? "" : "s"}`}
            </button>
          </>
        ) : step === "done" ? (
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90"
          >
            Done
          </button>
        ) : (
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container"
          >
            Cancel
          </button>
        )
      }
    >
      {step === "upload" && (
        <div ref={stepRef} tabIndex={-1} className="space-y-4 focus:outline-hidden">
          <div className="rounded-lg border border-dashed border-outline-variant bg-surface-container-low p-4">
            <p className="mb-1 text-sm font-semibold text-on-surface">Don't have a template yet?</p>
            <p className="mb-3 text-xs text-on-surface-variant">
              Download the Excel template, fill it in, then upload it back here.
            </p>
            <button
              type="button"
              onClick={downloadTemplate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-surface-container"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                download
              </span>
              Download template
            </button>
          </div>

          <div className="rounded-lg bg-surface-container-low p-3">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Valid stages
            </p>
            <div className="flex flex-wrap gap-1.5">
              {IMPORTABLE_STAGES.map((s) => (
                <Chip key={s} tone="gray">
                  {s.toLowerCase()}
                </Chip>
              ))}
            </div>
          </div>

          {/* N6: PIC matching depends on `users` being loaded — block the
              picker until the query resolves (success OR error) rather than
              letting a parse race ahead with an empty picByUsername map. */}
          {usersLoading && (
            <p role="status" aria-live="polite" className="text-xs text-on-surface-variant">
              Loading team members for PIC matching…
            </p>
          )}
          {usersError && (
            <Alert variant="warning">
              <AlertDescription>
                Couldn't load team members — PIC name matching will be skipped for this import.
              </AlertDescription>
            </Alert>
          )}

          <div
            role="button"
            aria-disabled={usersLoading}
            tabIndex={usersLoading ? -1 : 0}
            onClick={() => {
              if (usersLoading) return;
              fileRef.current?.click();
            }}
            onKeyDown={(e) => {
              if (usersLoading) return;
              if (e.key === "Enter" || e.key === " ") {
                // N5: without this, Space also scrolls the modal body (the
                // browser's default action for Space on a non-native,
                // focusable element) on top of opening the file picker.
                e.preventDefault();
                fileRef.current?.click();
              }
            }}
            className={`rounded-lg border-2 border-dashed border-outline-variant p-8 text-center transition-colors ${
              usersLoading ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-primary"
            }`}
          >
            {parsing ? (
              <div role="status" aria-live="polite" className="flex flex-col items-center gap-2">
                <span className="material-symbols-outlined animate-spin text-3xl text-primary" aria-hidden="true">
                  progress_activity
                </span>
                <p className="text-sm text-on-surface-variant">Reading file…</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-3xl text-on-surface-variant" aria-hidden="true">
                  upload_file
                </span>
                <p className="text-sm font-medium text-on-surface">Click to upload a file</p>
                <p className="text-xs text-on-surface-variant">Format: .xlsx or .csv</p>
                {fileName && <p className="mt-1 text-xs font-medium text-primary">{fileName}</p>}
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            disabled={usersLoading}
            onChange={handleFile}
          />

          {parseError && (
            <Alert variant="destructive">
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {step === "preview" && (
        <div ref={stepRef} tabIndex={-1} className="space-y-4 focus:outline-hidden">
          <div className="flex flex-wrap items-center gap-3">
            {/* S5: live region covers just the summary chips, not the
                "Change file" button — a screen reader shouldn't re-announce
                the button's own (unchanging) label every time the chip
                counts update. */}
            <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3">
              <Chip tone="emerald">{validCount} valid</Chip>
              {invalidCount > 0 && <Chip tone="rose">{invalidCount} invalid</Chip>}
            </div>
            <button
              type="button"
              onClick={handleChangeFile}
              className="ml-auto flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-sm" aria-hidden="true">
                close
              </span>
              Change file
            </button>
          </div>

          {validCount > IMPORT_ROW_CAP && (
            <Alert variant="warning">
              <AlertDescription>
                {validCount} rows are valid, but a single import is capped at {IMPORT_ROW_CAP}. Only the
                first {IMPORT_ROW_CAP} will be imported — split the rest into another file.
              </AlertDescription>
            </Alert>
          )}

          <div className="max-h-72 overflow-auto rounded-lg border border-outline-variant text-xs">
            <table className="w-full">
              <thead className="sticky top-0 bg-surface-container-low">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-on-surface-variant">#</th>
                  <th className="px-3 py-2 text-left font-semibold text-on-surface-variant">Status</th>
                  <th className="px-3 py-2 text-left font-semibold text-on-surface-variant">Title</th>
                  <th className="px-3 py-2 text-left font-semibold text-on-surface-variant">Company</th>
                  <th className="px-3 py-2 text-left font-semibold text-on-surface-variant">Deal value</th>
                  <th className="px-3 py-2 text-left font-semibold text-on-surface-variant">Stage</th>
                  <th className="px-3 py-2 text-left font-semibold text-on-surface-variant">PIC</th>
                  <th className="px-3 py-2 text-left font-semibold text-on-surface-variant">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.rowNum}
                    className={
                      row.status === "invalid"
                        ? "border-l-2 border-l-error bg-error-container/20"
                        : "border-l-2 border-l-transparent"
                    }
                  >
                    <td className="px-3 py-2 text-on-surface-variant">{row.rowNum}</td>
                    <td className="px-3 py-2">
                      {row.status === "valid" ? (
                        <Chip tone="emerald">Valid</Chip>
                      ) : (
                        <Chip tone="rose">Invalid</Chip>
                      )}
                    </td>
                    <td className="max-w-[150px] truncate px-3 py-2 font-medium text-on-surface">
                      {row.title || "—"}
                    </td>
                    <td className="max-w-[120px] truncate px-3 py-2 text-on-surface-variant">
                      {row.customerName || "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-on-surface">
                      {row.dealValue > 0 ? formatIDR(row.dealValue) : "—"}
                    </td>
                    <td className="px-3 py-2 text-on-surface-variant">{row.stage.toLowerCase() || "—"}</td>
                    <td className="px-3 py-2 text-on-surface-variant">
                      {row.picName ? (
                        <span className={row.picId ? "" : "italic text-warning"}>
                          {row.picName}
                          {!row.picId && " (not found)"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="max-w-[180px] px-3 py-2 text-error">
                      {row.status === "invalid" && row.errors.join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {submitError && (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {step === "done" && result && (
        <div ref={stepRef} tabIndex={-1} className="space-y-4 focus:outline-hidden">
          <div className="flex flex-wrap justify-center gap-6 py-2 text-center">
            <div>
              <p className="text-2xl font-bold text-on-surface">{result.totalRows}</p>
              {/* S3: relabeled from "Total rows" — `result.totalRows` is the
                  count of rows POSTed to the server (client-valid rows only,
                  capped at IMPORT_ROW_CAP), not every row in the workbook.
                  The old "Total rows" label read as "every row we saw", which
                  silently hid however many rows `invalidCount` (below) never
                  made it past the client-side preview at all. */}
              <p className="mt-0.5 text-xs text-on-surface-variant">Rows submitted</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-primary">{result.validCount}</p>
              <p className="mt-0.5 text-xs text-on-surface-variant">Imported</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-warning">{result.skipCount}</p>
              <p className="mt-0.5 text-xs text-on-surface-variant">Skipped</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-error">{result.invalidCount}</p>
              <p className="mt-0.5 text-xs text-on-surface-variant">Invalid</p>
            </div>
            <div>
              {/* S3: `invalidCount` here is the OUTER component-scope value
                  (rows.filter(status === "invalid").length) computed from the
                  preview's full parsed set, which is still around unchanged —
                  NOT `result.invalidCount` (that one only counts rows the
                  SERVER rejected among the ones actually submitted). These
                  rows never left the browser, so the server's response has
                  no record of them at all; this tile is the only place they
                  stay visible instead of silently vanishing between the
                  preview and done steps. */}
              <p className="text-2xl font-bold text-on-surface-variant">{invalidCount}</p>
              <p className="mt-0.5 text-xs text-on-surface-variant">Rejected before upload</p>
            </div>
          </div>

          {result.results.length > 0 && (
            <div className="max-h-64 overflow-auto rounded-lg border border-outline-variant text-xs">
              <table className="w-full">
                <thead className="sticky top-0 bg-surface-container-low">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-on-surface-variant">#</th>
                    <th className="px-3 py-2 text-left font-semibold text-on-surface-variant">Title</th>
                    <th className="px-3 py-2 text-left font-semibold text-on-surface-variant">Company</th>
                    <th className="px-3 py-2 text-left font-semibold text-on-surface-variant">Result</th>
                    <th className="px-3 py-2 text-left font-semibold text-on-surface-variant">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r, i) => {
                    // `r.row` is 1-based into the rows THIS DIALOG SUBMITTED
                    // (client-valid rows only) — used here purely to look up
                    // `submittedRows[r.row - 1]`, never rendered directly.
                    const submitted = submittedRows[r.row - 1];
                    return (
                      <tr key={`${r.row}-${i}`}>
                        {/* S3: the workbook row number (matches the preview
                            step's own "#" column), not `r.row` — `r.row` is
                            an index into the submitted subset, so on a
                            workbook where earlier rows were rejected
                            client-side, it would relabel e.g. workbook row 4
                            as "#1" here, disagreeing with what the preview
                            step showed for that same row. */}
                        <td className="px-3 py-2 text-on-surface-variant">
                          {submitted?.rowNum ?? r.row}
                        </td>
                        <td className="max-w-[150px] truncate px-3 py-2 text-on-surface">
                          {submitted?.title || "—"}
                        </td>
                        <td className="max-w-[120px] truncate px-3 py-2 text-on-surface-variant">
                          {submitted?.customerName || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Chip
                            tone={
                              r.status === "valid" ? "emerald" : r.status === "skipped" ? "amber" : "rose"
                            }
                          >
                            {r.status === "valid" ? "imported" : r.status}
                          </Chip>
                        </td>
                        <td className="max-w-[180px] px-3 py-2 text-on-surface-variant">{r.reason ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
