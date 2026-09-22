// Ticket list for the Customer Tickets tab (Task 1.8): a desktop table and a
// mobile card list in the same file (frontend/CLAUDE.md's "never a separate
// mobile component tree" convention) toggled with `hidden md:table` /
// `md:hidden`. Whole-row click opens the same "Open in iTop ↗" link the
// trailing action anchor exposes — the anchor stays the focusable element
// (frontend/CLAUDE.md's app-wide focus ring), the row click is a mouse-only
// convenience layered on top via `stopPropagation` on the anchor itself.
import { Chip } from "@/components/StatusChip";
import type { ItopTicketRow, ItopTicketScope } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ageLabel, itopTicketUrl, slaLabel, statusLabel, statusTone } from "./ticketPresentation";

const CLASS_LABEL: Record<string, string> = {
  UserRequest: "User request",
  Incident: "Incident",
};

const EMPTY_MESSAGE: Record<ItopTicketScope, string> = {
  ongoing: "No ongoing tickets",
  resolved_week: "Nothing resolved this week",
  // We can't tell here whether the current user has no `itopPersonId` at
  // all (never matched to an iTop person) vs. simply has no tickets
  // assigned — the tickets endpoint doesn't distinguish the two — so this
  // stays generic rather than guessing which case it is.
  mine: "No tickets assigned to you",
};

const OPEN_LINK_CLASS =
  "font-display text-[12px] font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

export function TicketsTable({
  tickets,
  baseUrl,
  scope,
}: {
  tickets: ItopTicketRow[];
  baseUrl: string | null;
  scope: ItopTicketScope;
}) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-sm border border-outline-variant bg-surface-container-lowest p-6 text-center text-sm text-on-surface-variant">
        {EMPTY_MESSAGE[scope]}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-sm border border-outline-variant bg-surface-container-lowest">
      {/* Desktop table (>= md) */}
      <table className="hidden w-full border-collapse text-sm md:table">
        <thead>
          <tr className="border-b border-outline-variant text-left">
            <th className="py-2 pl-3 pr-2 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
              Ref
            </th>
            <th className="py-2 pr-2 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
              Title
            </th>
            <th className="py-2 pr-2 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
              Type
            </th>
            <th className="py-2 pr-2 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
              Status
            </th>
            <th className="py-2 pr-2 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
              Agent
            </th>
            <th className="py-2 pr-2 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
              Age
            </th>
            <th className="py-2 pr-2 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
              SLA
            </th>
            <th className="py-2 pr-3" />
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => {
            const url = baseUrl ? itopTicketUrl(baseUrl, t) : null;
            return (
              <tr
                key={t.id}
                data-testid="itop-ticket-row"
                data-ref={t.ref}
                onClick={() => {
                  if (url) window.open(url, "_blank", "noopener,noreferrer");
                }}
                className={cn(
                  "border-b border-outline-variant/60 last:border-b-0",
                  url && "cursor-pointer hover:bg-surface-container-low",
                )}
              >
                <td className="py-2 pl-3 pr-2 font-mono text-[13px] text-on-surface">{t.ref}</td>
                <td className="max-w-[280px] truncate py-2 pr-2 text-on-surface" title={t.title}>
                  {t.title}
                </td>
                <td className="py-2 pr-2 text-on-surface-variant">
                  {CLASS_LABEL[t.class] ?? t.class}
                </td>
                <td className="py-2 pr-2">
                  <Chip tone={statusTone(t)}>{statusLabel(t.status)}</Chip>
                </td>
                <td className="py-2 pr-2 text-on-surface-variant">{t.agentName ?? "Unassigned"}</td>
                <td className="py-2 pr-2 font-mono text-[12px] text-on-surface-variant">
                  {ageLabel(t.startDate)}
                </td>
                <td className="py-2 pr-2 text-[12px] text-on-surface-variant">{slaLabel(t)}</td>
                <td className="py-2 pr-3 text-right">
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="itop-open-link"
                      onClick={(e) => e.stopPropagation()}
                      className={OPEN_LINK_CLASS}
                    >
                      Open in iTop ↗
                    </a>
                  ) : (
                    <span className="text-[12px] text-on-surface-variant">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Mobile card list (< md) — two-line card: ref + status chip on line
          1, title on line 2, age/SLA + the open link on line 3. */}
      <ul className="divide-y divide-outline-variant/60 md:hidden">
        {tickets.map((t) => {
          const url = baseUrl ? itopTicketUrl(baseUrl, t) : null;
          return (
            <li key={t.id} data-testid="itop-ticket-row" data-ref={t.ref} className="p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[13px] text-on-surface">{t.ref}</span>
                <Chip tone={statusTone(t)}>{statusLabel(t.status)}</Chip>
              </div>
              <p className="mt-1 truncate text-sm text-on-surface">{t.title}</p>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-on-surface-variant">
                <span>
                  {ageLabel(t.startDate)} · {slaLabel(t)}
                </span>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="itop-open-link"
                    className={OPEN_LINK_CLASS}
                  >
                    Open in iTop ↗
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
