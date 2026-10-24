// Settings › Outline: connect / disconnect the signed-in user's own Outline
// account (docs/archive/plans/outline-integration.md, D2 - every Outline call
// runs under THIS user's OAuth token, accepted only when Outline's email is
// theirs). Also shows the outcome of a return from Outline's consent screen
// (`/settings?outline=connected|cancelled|error&reason=…`) and then strips
// those parameters from the URL.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Chip } from "@/components/StatusChip";
import { useConnectOutline } from "@/hooks/useConnectOutline";
import { fmtDateTime } from "@/lib/formatDate";
import { outlineReturnNotice, stripOutlineReturnParams, type OutlineNotice } from "@/lib/outlineDocs";
import {
  queryKeys,
  useDisconnectOutline,
  useOutlineConfig,
  useOutlineMe,
} from "@/lib/queries";

export function OutlineConnectCard() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [notice, setNotice] = useState<OutlineNotice | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const { data: config, isLoading: configLoading } = useOutlineConfig();
  // No Outline address, no requests: the connection is only asked about once the
  // admin has set one.
  const addressSet = Boolean(config?.baseUrl);
  const { data: me, isLoading: meLoading } = useOutlineMe(addressSet);
  const disconnect = useDisconnectOutline();
  const { connect, pending, error: connectError } = useConnectOutline();

  // A return from Outline: show the outcome once, re-read the connection, and
  // drop the parameters so a reload does not repeat the message.
  useEffect(() => {
    const next = outlineReturnNotice(searchParams);
    if (!next) return;
    setNotice(next);
    void qc.invalidateQueries({ queryKey: queryKeys.outlineMe });
    setSearchParams(stripOutlineReturnParams(searchParams), { replace: true });
  }, [searchParams, setSearchParams, qc]);

  async function handleDisconnect() {
    setDisconnectError(null);
    try {
      await disconnect.mutateAsync();
      setConfirmOpen(false);
      setNotice(null);
    } catch {
      setConfirmOpen(false);
      setDisconnectError("Could not disconnect Outline. Try again.");
    }
  }

  const noticeAlert = notice && (
    <Alert
      variant={notice.tone === "error" ? "destructive" : notice.tone === "success" ? "success" : "info"}
      data-testid="outline-return-notice"
    >
      <AlertDescription>{notice.message}</AlertDescription>
    </Alert>
  );

  // Nothing while the settings load: a skeleton would flash on installs that
  // have no Outline at all.
  if (configLoading || meLoading) return null;

  // No Outline address at all: the feature does not exist for this install.
  if (!addressSet) {
    return noticeAlert ? <div className="space-y-3">{noticeAlert}</div> : null;
  }

  const connected = me?.connected === true;
  const configured = me?.configured === true;

  return (
    <section
      aria-label="Outline"
      data-testid="outline-connect-card"
      className="space-y-3 rounded-sm border border-outline-variant bg-surface-container-lowest p-5"
    >
      <h2 className="font-display text-[13px] font-bold uppercase tracking-wider text-on-surface">
        Outline
      </h2>
      {noticeAlert}
      {(connectError || disconnectError) && (
        <Alert variant="destructive">
          <AlertDescription>{connectError ?? disconnectError}</AlertDescription>
        </Alert>
      )}

      {connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-chip-emerald-bg text-chip-emerald-text"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">link</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-sm font-semibold text-on-surface">
                  Your Outline account
                </span>
                <Chip tone="emerald">Connected</Chip>
              </div>
              <p className="text-xs text-on-surface-variant" data-testid="outline-connected-as">
                Signed in as {me?.outlineEmail}
                {me?.expiresAt ? ` · access renews automatically (${fmtDateTime(me.expiresAt)})` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="rounded-sm border border-outline-variant px-4 py-1.5 font-display text-xs font-semibold text-on-surface hover:bg-surface-container"
          >
            Disconnect
          </button>
        </div>
      ) : configured ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-dashed border-outline-variant p-4">
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-container-high text-on-surface-variant"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">link_off</span>
            </div>
            <div>
              <span className="font-display text-sm font-semibold text-on-surface">
                Not connected yet
              </span>
              <p className="text-xs text-on-surface-variant">
                Opens Outline, you approve access once, and you come back here.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-semibold text-on-primary hover:bg-primary-container disabled:opacity-60"
          >
            {pending ? "Opening Outline…" : "Connect Outline"}
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              open_in_new
            </span>
          </button>
        </div>
      ) : (
        <p className="text-sm text-on-surface-variant" data-testid="outline-not-configured">
          Outline is not set up for sign-in yet. An administrator needs to finish the Outline
          settings (address and OAuth client) before you can connect.
        </p>
      )}

      <p className="text-xs text-on-surface-variant">
        Solvro uses your own Outline account to list pages, search and create docs. You see only
        what you can open in Outline. Disconnect at any time; Solvro then stops all Outline calls
        for you.
      </p>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void handleDisconnect()}
        title="Disconnect Outline"
        body="Disconnect your Outline account? The Docs tab, search and “Mentioned in” stop showing Outline pages for you until you connect again."
        confirmLabel="Disconnect"
        confirmTone="danger"
        busy={disconnect.isPending}
      />
    </section>
  );
}
