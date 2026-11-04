// The muted one-line "why can't I create a ticket" text, with the fixable part
// linked (Settings for the token, Admin → iTop for admins only — the gate sets
// `fix` only when the viewer can follow it).
import { Link } from "react-router-dom";
import type { CreateGate } from "./createGate";

export function GateReason({ gate, className }: { gate: CreateGate; className?: string }) {
  if (!gate.reason) return null;
  const { reason, fix } = gate;
  const at = fix ? reason.indexOf(fix.label) : -1;
  return (
    <span className={className}>
      {fix && at >= 0 ? (
        <>
          {reason.slice(0, at)}
          <Link to={fix.to} className="underline hover:text-on-surface">
            {fix.label}
          </Link>
          {reason.slice(at + fix.label.length)}
        </>
      ) : (
        reason
      )}
    </span>
  );
}
