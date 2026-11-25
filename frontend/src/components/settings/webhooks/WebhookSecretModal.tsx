import { Modal } from "@/components/Modal";
import { CopyField } from "@/components/admin/CopyField";

/**
 * The signing secret, shown once after create or rotate. Nothing stores it
 * client-side: closing this dialog is the last time it is on screen.
 */
export function WebhookSecretModal({
  secret,
  webhookName,
  rotated,
  onClose,
}: {
  secret: string | null;
  webhookName: string;
  rotated?: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={secret != null}
      onClose={onClose}
      title={rotated ? "New signing secret" : "Webhook created"}
      footer={
        <button
          type="button"
          data-autofocus
          onClick={onClose}
          className="[@media(pointer:coarse)]:min-h-11 rounded-sm bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          I have saved it
        </button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-on-surface">
          {rotated
            ? `The old secret for ${webhookName} no longer works. Put this one in the receiver.`
            : `Use this secret in the receiver to check the signature of each request from ${webhookName}.`}
        </p>
        {secret && <CopyField value={secret} label="signing secret" testId="webhook-secret" />}
        <p role="note" className="text-meta text-on-surface-variant">
          This secret is shown once and will not be shown again. If you lose it, rotate the secret.
        </p>
      </div>
    </Modal>
  );
}
