// Operations card (spec §6.3 pin 6): one per customer, always rendered —
// issues that belong to no project. Same Mon..Sun editor as ProjectCard,
// with a required, manually-typed Title (Decision 4, 2026-08-29) instead of
// a service selector.
//
// Task 2.2 (docs/archive/plans/itop-integration.md): the iTop daily strip
// sits at the top of this card, under the header and above the week notes
// (docs/archive/plans/itop-integration-spec.md §2: the strip "sits on the operations card").
// This component owns the `pendingInsert` state WeekNotesEditor consumes —
// a plain `onAddToNote` prop closes directly over `setPendingInsert`, no
// ref/imperative-handle indirection needed now that the strip is a child
// rather than a CustomerGroup-level sibling. `onPendingInsertApplied`
// clears that state back to `null` once WeekNotesEditor has applied an
// insert — without that, the insert would sit there forever and re-apply
// itself the next time the editor remounts (e.g. on a week switch, which
// resets WeekNotesEditor's own one-shot guard along with everything else it
// owns).
import { useState } from "react";
import { DailyItopStrip } from "@/components/itop/DailyItopStrip";
import { Input } from "@/components/ui/input";
import {
  type DailyItopCustomer,
  type DailyReviewCustomer,
  useAddCustomerNote,
  useDeleteCustomerNote,
  useUpdateCustomerNote,
} from "@/lib/queries";
import { WeekNotesEditor } from "./WeekNotesEditor";

export interface OperationsCardProps {
  customer: DailyReviewCustomer;
  today: string;
  days: string[];
  currentUserId: number;
  canDeleteAny: boolean;
  /** This customer's slice of GET /itop/daily — absent when iTop isn't configured or the customer isn't mapped to an org (Task 2.2). */
  itop?: DailyItopCustomer;
}

export function OperationsCard({ customer, today, days, currentUserId, canDeleteAny, itop }: OperationsCardProps) {
  const addNote = useAddCustomerNote(customer.id);
  const updateNote = useUpdateCustomerNote(customer.id);
  const deleteNote = useDeleteCustomerNote(customer.id);

  const [pendingInsert, setPendingInsert] = useState<{ text: string; token: number } | null>(null);

  const noteCount = customer.operationsNotes.length;
  // The viewed week may not contain today (Prev/Next) — WeekNotesEditor has
  // no persistent today row to append into then, so the strip goes
  // read-only (no "Add to note" buttons) rather than silently dropping the
  // insert into a day that isn't today.
  const hasTodayRow = days.includes(today);

  return (
    <article className="rounded-sm border border-outline-variant bg-surface-container-lowest">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-outline-variant px-4 py-3">
        <span className="rounded-sm bg-surface-container-high px-1.5 py-0.5 text-label-caps leading-4 uppercase text-on-surface-variant">
          Operations
        </span>
        <span className="font-display text-sm font-semibold text-on-surface">
          {customer.name} · issues outside a project
        </span>
        <span className="ml-auto text-meta tabular-nums text-on-surface-variant">
          {noteCount} note{noteCount === 1 ? "" : "s"} this week
        </span>
      </header>

      {itop && (
        <div className="px-4 pt-3">
          <DailyItopStrip
            itop={itop}
            onAddToNote={
              hasTodayRow ? (text) => setPendingInsert({ text, token: Date.now() }) : undefined
            }
          />
        </div>
      )}

      <div className="px-4 py-3">
        <WeekNotesEditor
          // Keyed by the displayed week's Monday — see ProjectCard.tsx's
          // identical WeekNotesEditor usage for why.
          key={days[0]}
          days={days}
          today={today}
          notes={customer.operationsNotes}
          currentUserId={currentUserId}
          canDeleteAny={canDeleteAny}
          placeholder="What happened outside a project today?"
          ariaLabel={`Operations note for ${customer.name}`}
          rowsId={`week-rows-customer-${customer.id}`}
          extraFromNote={(note) => ({ title: note.title })}
          extraValid={(extra) => extra.title.trim().length > 0}
          renderPrefix={(note) => (
            <p className="mb-0.5 text-sm font-semibold text-on-surface">{note.title}</p>
          )}
          renderExtraFields={(extra, setExtra) => (
            <Input
              value={extra.title}
              onChange={(e) => setExtra({ ...extra, title: e.target.value })}
              placeholder="Title, e.g. Oslo edge tunnel outage"
              aria-label="Title"
              maxLength={120}
              required
            />
          )}
          onAdd={(day, body, extra) =>
            addNote.mutate({
              body,
              noteDate: day,
              title: extra.title.trim(),
            })
          }
          onUpdate={(noteId, body, extra) =>
            updateNote.mutate({
              noteId,
              body,
              title: extra.title.trim(),
            })
          }
          onDelete={(noteId) => deleteNote.mutate({ noteId })}
          addPending={addNote.isPending}
          updatePending={updateNote.isPending}
          deletePending={deleteNote.isPending}
          pendingInsert={pendingInsert}
          onPendingInsertApplied={() => setPendingInsert(null)}
        />
      </div>
    </article>
  );
}
