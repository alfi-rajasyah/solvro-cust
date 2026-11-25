import { useState } from "react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorAlert } from "@/components/QueryErrorAlert";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { CardGridSkeleton } from "@/components/skeletons";
import { Chip } from "@/components/StatusChip";
import {
  useDeleteWebhook,
  useRotateWebhookSecret,
  useTestWebhook,
  useUpdateWebhook,
  useWebhooks,
  type Webhook,
  type WebhookTestResult,
} from "@/lib/queries";
import { WEBHOOK_FORMAT_LABEL, deliveryErrorLabel } from "@/lib/labels";
import { WebhookDeliveriesModal } from "./WebhookDeliveriesModal";
import { WebhookFormModal } from "./WebhookFormModal";
import { WebhookSecretModal } from "./WebhookSecretModal";
import {
  eventLabels,
  eventsSummary,
  lastDeliveryText,
  projectsSummary,
  webhookErrorMessage,
} from "./webhookPresentation";

const ROW_BUTTON =
  "[@media(pointer:coarse)]:min-h-11 rounded-sm border border-outline-variant px-2.5 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-60 focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30";
const PRIMARY_BUTTON =
  "[@media(pointer:coarse)]:min-h-11 rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-semibold text-on-primary hover:bg-primary/90 disabled:opacity-60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

type FormState = { open: false } | { open: true; webhook: Webhook | null };

/** The signed-in user's outgoing webhooks. Rendered inside Settings' Integrations tab for webhook:manage. */
export function WebhooksPanel() {
  const { data: webhooks, isLoading, isError, error, refetch } = useWebhooks();
  const update = useUpdateWebhook();
  const remove = useDeleteWebhook();
  const rotate = useRotateWebhookSecret();
  const test = useTestWebhook();

  const [form, setForm] = useState<FormState>({ open: false });
  const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null);
  const [confirmRotate, setConfirmRotate] = useState<Webhook | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Webhook | null>(null);
  const [secret, setSecret] = useState<{ value: string; name: string; rotated: boolean } | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, WebhookTestResult | string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleToggle(w: Webhook) {
    setActionError(null);
    try {
      await update.mutateAsync({ id: w.id, active: !w.active });
    } catch (err) {
      setActionError(webhookErrorMessage(err, `Could not ${w.active ? "disable" : "enable"} ${w.name}.`));
    }
  }

  async function handleTest(w: Webhook) {
    setActionError(null);
    setTestingId(w.id);
    try {
      const result = await test.mutateAsync(w.id);
      setTestResults((prev) => ({ ...prev, [w.id]: result }));
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [w.id]: webhookErrorMessage(err, "The test could not be sent.") }));
    } finally {
      setTestingId(null);
    }
  }

  async function handleRotate() {
    const w = confirmRotate;
    if (!w) return;
    setActionError(null);
    try {
      const res = await rotate.mutateAsync(w.id);
      setConfirmRotate(null);
      setSecret({ value: res.secret, name: w.name, rotated: true });
    } catch (err) {
      setConfirmRotate(null);
      setActionError(webhookErrorMessage(err, `Could not rotate the secret of ${w.name}.`));
    }
  }

  async function handleDelete() {
    const w = confirmDelete;
    if (!w) return;
    setActionError(null);
    try {
      await remove.mutateAsync(w.id);
      setConfirmDelete(null);
    } catch (err) {
      setConfirmDelete(null);
      setActionError(webhookErrorMessage(err, `Could not delete ${w.name}.`));
    }
  }

  const addButton = (
    <button type="button" onClick={() => setForm({ open: true, webhook: null })} className={PRIMARY_BUTTON}>
      Add webhook
    </button>
  );

  let body;
  if (isLoading) {
    body = <CardGridSkeleton count={1} gridClassName="grid-cols-1" />;
  } else if (isError) {
    body = <QueryErrorAlert title="Could not load webhooks" error={error} onRetry={refetch} />;
  } else if (!webhooks || webhooks.length === 0) {
    body = (
      <EmptyState
        icon="webhook"
        title="No webhooks yet"
        message="A webhook sends an event, such as a new task or comment, to another tool or a Google Chat space as it happens."
        action={addButton}
      />
    );
  } else {
    body = (
      <>
        <ul className="divide-y divide-outline-variant rounded-sm border border-outline-variant">
          {webhooks.map((w) => (
            <WebhookRow
              key={w.id}
              webhook={w}
              testing={testingId === w.id}
              testResult={testResults[w.id]}
              busy={update.isPending}
              onEdit={() => setForm({ open: true, webhook: w })}
              onTest={() => void handleTest(w)}
              onDeliveries={() => setDeliveriesFor(w)}
              onRotate={() => setConfirmRotate(w)}
              onToggle={() => void handleToggle(w)}
              onDelete={() => setConfirmDelete(w)}
            />
          ))}
        </ul>
        <div className="mt-3">{addButton}</div>
      </>
    );
  }

  return (
    <div className="space-y-3">
      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}
      {body}

      <WebhookFormModal
        open={form.open}
        webhook={form.open ? form.webhook : null}
        onClose={() => setForm({ open: false })}
        onCreated={(created, value) => {
          setForm({ open: false });
          if (value) setSecret({ value, name: created.name, rotated: false });
        }}
      />
      <WebhookSecretModal
        secret={secret?.value ?? null}
        webhookName={secret?.name ?? ""}
        rotated={secret?.rotated}
        onClose={() => setSecret(null)}
      />
      <WebhookDeliveriesModal webhook={deliveriesFor} onClose={() => setDeliveriesFor(null)} />
      <ConfirmModal
        open={confirmRotate != null}
        onClose={() => setConfirmRotate(null)}
        onConfirm={() => void handleRotate()}
        title="Rotate signing secret?"
        body={`The current secret of ${confirmRotate?.name ?? "this webhook"} stops working at once. Deliveries are rejected by the receiver until you give it the new one.`}
        confirmLabel="Rotate secret"
        confirmTone="warning"
        busy={rotate.isPending}
      />
      <ConfirmModal
        open={confirmDelete != null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => void handleDelete()}
        title="Delete webhook?"
        body={`${confirmDelete?.name ?? "This webhook"} and its delivery history are removed, and nothing more is sent to it.`}
        confirmLabel="Delete webhook"
        confirmTone="danger"
        busy={remove.isPending}
      />
    </div>
  );
}

function WebhookRow({
  webhook: w,
  testing,
  testResult,
  busy,
  onEdit,
  onTest,
  onDeliveries,
  onRotate,
  onToggle,
  onDelete,
}: {
  webhook: Webhook;
  testing: boolean;
  testResult: WebhookTestResult | string | undefined;
  busy: boolean;
  onEdit: () => void;
  onTest: () => void;
  onDeliveries: () => void;
  onRotate: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const failedLast = w.lastDelivery?.status === "FAILED";
  return (
    <li className="space-y-2 px-3 py-3" data-testid={`webhook-${w.id}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words font-display text-sm font-semibold text-on-surface">{w.name}</span>
        <Chip tone={w.active ? "emerald" : "amber"}>{w.active ? "Active" : "Disabled"}</Chip>
      </div>
      <p className="break-all font-mono text-meta text-on-surface-variant">{w.host}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-meta">
        <dt className="text-on-surface-variant">Format</dt>
        <dd className="text-on-surface">{WEBHOOK_FORMAT_LABEL[w.format]}</dd>
        <dt className="text-on-surface-variant">Events</dt>
        <dd className="text-on-surface" title={eventLabels(w.eventTypes).join(", ")}>
          {eventsSummary(w.eventTypes)}
        </dd>
        <dt className="text-on-surface-variant">Projects</dt>
        <dd className="text-on-surface">{projectsSummary(w.projectIds)}</dd>
        <dt className="text-on-surface-variant">Last delivery</dt>
        <dd className={failedLast ? "text-error" : "text-on-surface"}>{lastDeliveryText(w.lastDelivery)}</dd>
      </dl>
      {!w.active && w.disabledReason && (
        <p className="text-meta text-chip-amber-text">Disabled: {w.disabledReason}</p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={onTest} disabled={testing} className={ROW_BUTTON}>
          {testing ? "Sending…" : "Send test"}
        </button>
        <button type="button" onClick={onDeliveries} className={ROW_BUTTON}>
          Deliveries
        </button>
        <button type="button" onClick={onEdit} className={ROW_BUTTON}>
          Edit
        </button>
        {w.format === "STANDARD" && (
          <button type="button" onClick={onRotate} className={ROW_BUTTON}>
            Rotate secret
          </button>
        )}
        <button type="button" onClick={onToggle} disabled={busy} className={ROW_BUTTON}>
          {w.active ? "Disable" : "Enable"}
        </button>
        <button type="button" onClick={onDelete} className={`${ROW_BUTTON} text-error`}>
          Delete
        </button>
      </div>
      <div role="status" aria-live="polite">
        {testResult !== undefined && <TestResultLine result={testResult} />}
      </div>
    </li>
  );
}

function TestResultLine({ result }: { result: WebhookTestResult | string }) {
  if (typeof result === "string") return <p className="text-meta text-error">{result}</p>;
  if (result.ok) {
    return (
      <p className="text-meta text-on-surface">
        Test delivered{result.statusCode != null ? ` (${result.statusCode})` : ""}.
      </p>
    );
  }
  return (
    <p className="text-meta text-error">
      Test failed{result.statusCode != null ? ` (${result.statusCode})` : ""}
      {result.error ? `: ${deliveryErrorLabel(result.error)}` : "."}
    </p>
  );
}
