import {
  EMBED_BUTTON_SECONDARY,
  EmbedExternalLink,
  EmbedFrame,
  EmbedMessage,
} from "./EmbedParts";

// Catch-all for /embed/* and /share/* paths no route matches. The widened
// framing CSP applies to the whole prefix (frontend/nginx-frame-protection),
// so an unknown path must render in place: redirecting into the app shell
// would let the whole app load inside someone else's frame. The only way out
// is a link that opens Solvro in a new top-level tab.
export function EmbedInvalidLink({ kind }: { kind: "embed" | "guest" }) {
  return (
    <EmbedFrame>
      <EmbedMessage
        icon="link_off"
        title={kind === "embed" ? "This embed link isn't valid" : "This guest link isn't valid"}
        hint={
          kind === "embed"
            ? "Copy the embed link again from the project in Solvro."
            : "Ask the person who shared it with you for a new link."
        }
        testId="embed-invalid-link"
        role="alert"
      >
        <EmbedExternalLink href="/" className={EMBED_BUTTON_SECONDARY}>
          Open Solvro
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            open_in_new
          </span>
        </EmbedExternalLink>
      </EmbedMessage>
    </EmbedFrame>
  );
}
