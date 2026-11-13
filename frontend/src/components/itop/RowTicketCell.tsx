// Ticket cell for a task or subtask row (project List and the panel's subtask
// list). Shows the pinned iTop ref as a mono chip with a status dot (closed
// tickets dimmed), or "—" / a dashed "+ Ticket" for editors. The menu offers
// "Pin existing iTop ticket…" and "Create iTop ticket…"; creation runs under
// the acting user's personal token inside `NewTicketSheet` and the new ref is
// pinned to THIS row via PATCH /tasks/:id (docs/archive/plans/subtask-itop-tickets.md).
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError } from "@/lib/api";
import { useUpdateTask, type ItopTicketRow, type Task } from "@/lib/queries";
import type { CreateGate } from "./createGate";
import { GateReason } from "./GateReason";
import { NewTicketSheet } from "./NewTicketSheet";
import { buildTicketPrefill } from "./ticketPrefill";
import { isItopRef, itopTicketUrl, statusLabel, statusTone, type TicketTone } from "./ticketPresentation";
import { EMPTY_VALUE } from "@/lib/emptyValue";

const DOT_CLASS: Record<TicketTone, string> = {
  emerald: "bg-chip-emerald-text",
  amber: "bg-chip-amber-text",
  rose: "bg-chip-rose-text",
  violet: "bg-chip-violet-text",
  blue: "bg-primary",
  gray: "bg-on-surface-variant",
};

/** Everything a row needs to render its ticket cell; built once per List/panel. */
export interface RowTicketContext {
  projectId: number;
  projectName: string;
  customerId: number | null;
  /** 2+ iTop-mapped customers on the project: the sheet's Organisation picker (`customerId` is the default). */
  organisations?: ReadonlyArray<{ id: number; name: string }>;
  organisationLabel?: string | null;
  baseUrl: string | null;
  gate: CreateGate;
  /** Lookup results from the batched by-refs request (undefined while loading). */
  byRef: Record<string, ItopTicketRow | null> | undefined;
}

const MENU_TRIGGER_CLASS =
  "tap-target inline-flex max-w-full items-center gap-1.5 rounded-sm outline-hidden focus-visible:ring-2";

export function RowTicketCell({
  task,
  parentTitle = null,
  canEdit,
  ctx,
  onOverlayOpenChange,
}: {
  task: Pick<Task, "id" | "title" | "description" | "itopTicketRef">;
  /** The parent task's title for a subtask row (null for a top-level task). */
  parentTitle?: string | null;
  canEdit: boolean;
  ctx: RowTicketContext;
  /** Reports whether the pin dialog or New-ticket sheet is open, so a host panel can leave Escape to it. */
  onOverlayOpenChange?: (open: boolean) => void;
}) {
  const updateTask = useUpdateTask(ctx.projectId);
  const [createOpen, setCreateOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reportOverlay = useRef(onOverlayOpenChange);
  reportOverlay.current = onOverlayOpenChange;
  const overlayOpen = createOpen || pinOpen;
  // Balanced +1/-1 reports only: a cell that never opened an overlay never
  // reports, so mounting or unmounting it cannot clear another cell's flag.
  const reported = useRef(false);
  useEffect(() => {
    if (overlayOpen && !reported.current) {
      reported.current = true;
      reportOverlay.current?.(true);
    } else if (!overlayOpen && reported.current) {
      reported.current = false;
      reportOverlay.current?.(false);
    }
  }, [overlayOpen]);
  useEffect(
    () => () => {
      if (reported.current) reportOverlay.current?.(false);
    },
    [],
  );

  const ref = task.itopTicketRef;
  const ticket = ref ? ctx.byRef?.[ref] ?? null : null;
  const prefill = buildTicketPrefill({
    title: task.title,
    description: task.description,
    projectName: ctx.projectName,
    parentTitle,
  });

  function pin(value: string | null, createdRef?: string) {
    setActionError(null);
    updateTask.mutate(
      { id: task.id, patch: { itopTicketRef: value } },
      {
        onError: (err) => {
          const msg = err instanceof ApiError ? err.message : "Could not save the ticket.";
          setActionError(createdRef ? `Created ${createdRef}, but pinning failed: ${msg}` : msg);
        },
      },
    );
  }

  function submitPin() {
    const value = draft.trim().toUpperCase();
    if (!isItopRef(value)) {
      setPinError("Use the iTop ref, e.g. R-004512");
      return;
    }
    setPinOpen(false);
    pin(value);
  }

  function openPin() {
    setDraft(ref ?? "");
    setPinError(null);
    setPinOpen(true);
  }

  const url = ticket && ctx.baseUrl ? itopTicketUrl(ctx.baseUrl, ticket) : null;
  const dimmed = ticket && (ticket.status === "closed" || ticket.status === "resolved");

  const chip = ref ? (
    <>
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${ticket ? DOT_CLASS[statusTone(ticket)] : "bg-outline-variant"}`}
      />
      <span className="truncate font-mono text-meta text-on-surface">{ref}</span>
      {ticket && <span className="sr-only">{statusLabel(ticket.status)}</span>}
    </>
  ) : null;

  let trigger: React.ReactNode;
  if (ref) {
    const chipClass = `${MENU_TRIGGER_CLASS} rounded-full bg-surface-container-high px-2 py-0.5 focus-visible:ring-primary ${dimmed ? "opacity-60" : ""}`;
    trigger = canEdit ? (
      <DropdownMenuTrigger
        render={<button type="button" aria-label={`iTop ticket ${ref}`} className={chipClass} />}
      >
        {chip}
      </DropdownMenuTrigger>
    ) : url ? (
      <a href={url} target="_blank" rel="noopener noreferrer" className={chipClass}>
        {chip}
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    ) : (
      <span className={chipClass}>{chip}</span>
    );
  } else if (canEdit) {
    trigger = (
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Add iTop ticket to ${task.title}`}
            title={ctx.gate.reason ?? undefined}
            className={`${MENU_TRIGGER_CLASS} border border-dashed border-outline-variant focus-visible:ring-primary/30 px-2 py-0.5 font-display text-meta font-semibold text-on-surface-variant hover:border-primary hover:text-primary focus-visible:border-primary`}
          />
        }
      >
        + Ticket
      </DropdownMenuTrigger>
    );
  } else {
    return <span className="text-meta text-on-surface-variant">{EMPTY_VALUE}</span>;
  }

  return (
    <span className="inline-flex min-w-0 max-w-full flex-col items-start" onClick={(e) => e.stopPropagation()}>
      {canEdit ? (
        <DropdownMenu>
          {trigger}
          {/* z-50 on the Positioner: this menu opens over the page and the task panel, below Modal's z-100 (the z-101 picker rule is for pickers inside a Modal). */}
          <DropdownMenuContent
            align="start"
            className="w-60 bg-surface-container-lowest shadow-overlay!"
            positionerClassName="z-50"
          >
            {url && (
              <DropdownMenuItem
                className="text-xs"
                render={<a href={url} target="_blank" rel="noopener noreferrer" />}
              >
                Open in iTop
                <span aria-hidden="true" className="material-symbols-outlined text-sm">open_in_new</span>
                <span className="sr-only">(opens in a new tab)</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-xs" onClick={openPin}>
              {ref ? "Pin a different ticket…" : "Pin existing iTop ticket…"}
            </DropdownMenuItem>
            {!ref && ctx.gate.canCreate && ctx.customerId !== null && (
              <DropdownMenuItem className="text-xs" onClick={() => setCreateOpen(true)}>
                Create iTop ticket…
              </DropdownMenuItem>
            )}
            {ref && (
              <DropdownMenuItem className="text-xs" onClick={() => pin(null)}>
                Unpin ticket
              </DropdownMenuItem>
            )}
            {!ref && !ctx.gate.canCreate && ctx.gate.reason && (
              <DropdownMenuLabel className="text-meta font-normal text-on-surface-variant">
                <GateReason gate={ctx.gate} />
              </DropdownMenuLabel>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        trigger
      )}

      {actionError && (
        <span role="alert" className="mt-0.5 text-meta text-error">
          {actionError}
        </span>
      )}

      {pinOpen && (
        <span onClick={(e) => e.stopPropagation()}>
          <Modal
            open
            onClose={() => setPinOpen(false)}
            title="Pin an iTop ticket"
            widthClass="max-w-sm"
            footer={
              <>
                <button
                  type="button"
                  onClick={() => setPinOpen(false)}
                  className="[@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:justify-center rounded-sm border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitPin}
                  className="[@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:justify-center rounded-sm bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90"
                >
                  Pin
                </button>
              </>
            }
          >
            <label className="block">
              <span className="mb-1.5 block text-label-caps uppercase text-on-surface-variant">iTop ref</span>
              <input
                autoFocus
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitPin();
                }}
                placeholder="R-000000"
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1.5 font-mono text-sm text-on-surface focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
              />
            </label>
            {pinError && (
              <p role="alert" className="mt-2 text-xs text-error">
                {pinError}
              </p>
            )}
          </Modal>
        </span>
      )}

      {createOpen && ctx.customerId !== null && (
        <span onClick={(e) => e.stopPropagation()}>
          <NewTicketSheet
            open
            onClose={() => setCreateOpen(false)}
            customerId={ctx.customerId}
            organisations={ctx.organisations}
            organisationLabel={ctx.organisationLabel}
            initialTitle={prefill.title}
            initialDescription={prefill.description}
            pinTarget
            onCreated={(created) => {
              setCreateOpen(false);
              pin(created.ref, created.ref);
            }}
          />
        </span>
      )}
    </span>
  );
}
