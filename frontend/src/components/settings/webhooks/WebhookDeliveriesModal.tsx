import { Modal } from "@/components/Modal";
import { QueryErrorAlert } from "@/components/QueryErrorAlert";
import { TableSkeleton } from "@/components/skeletons";
import { EMPTY_VALUE } from "@/lib/emptyValue";
import { fmtDateTime } from "@/lib/formatDate";
import { DELIVERY_STATUS_LABEL, WEBHOOK_EVENT_LABEL, deliveryErrorLabel } from "@/lib/labels";
import { useWebhookDeliveries, type Webhook } from "@/lib/queries";

/** The last 50 deliveries of one webhook, newest first. */
export function WebhookDeliveriesModal({ webhook, onClose }: { webhook: Webhook | null; onClose: () => void }) {
  const q = useWebhookDeliveries(webhook?.id ?? null);
  const rows = q.data ?? [];
  return (
    <Modal
      open={webhook != null}
      onClose={onClose}
      title={webhook ? `Deliveries: ${webhook.name}` : "Deliveries"}
      widthClass="max-w-3xl"
      footer={
        <button
          type="button"
          data-autofocus
          onClick={onClose}
          className="[@media(pointer:coarse)]:min-h-11 rounded-sm border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          Close
        </button>
      }
    >
      {q.isError ? (
        <QueryErrorAlert title="Could not load deliveries" error={q.error} onRetry={q.refetch} />
      ) : q.isLoading ? (
        <TableSkeleton rows={4} columns={5} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-on-surface-variant">
          Nothing sent yet. Deliveries appear here once a matching event happens.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <caption className="sr-only">Last {rows.length} deliveries, newest first</caption>
            <thead>
              <tr className="border-b border-outline-variant text-label-caps uppercase text-on-surface-variant">
                <th scope="col" className="py-2 pr-3 font-bold">Event</th>
                <th scope="col" className="py-2 pr-3 font-bold">Status</th>
                <th scope="col" className="py-2 pr-3 font-bold">Attempts</th>
                <th scope="col" className="py-2 pr-3 font-bold">Code</th>
                <th scope="col" className="py-2 font-bold">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-b border-outline-variant align-top last:border-b-0">
                  <td className="py-2 pr-3 text-on-surface">{WEBHOOK_EVENT_LABEL[d.eventType] ?? d.eventType}</td>
                  <td className="py-2 pr-3">
                    <span className={d.status === "FAILED" ? "text-error" : "text-on-surface"}>
                      {DELIVERY_STATUS_LABEL[d.status]}
                    </span>
                    {d.status === "FAILED" && d.lastError && (
                      <span className="block max-w-xs break-words text-meta text-on-surface-variant">{deliveryErrorLabel(d.lastError)}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-on-surface">{d.attempts}</td>
                  <td className="py-2 pr-3 tabular-nums text-on-surface">{d.lastStatusCode ?? EMPTY_VALUE}</td>
                  <td className="whitespace-nowrap py-2 text-on-surface-variant">{fmtDateTime(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
