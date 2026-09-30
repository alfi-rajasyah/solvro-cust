/**
 * Copy text with a fallback for insecure origins. navigator.clipboard is
 * only defined in secure contexts (HTTPS / localhost); prod is served over
 * plain HTTP on the LAN, so fall back to the legacy textarea + execCommand
 * path there. Throws if both paths fail so callers can toast the error.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // ta.select() steals focus and removing the textarea leaves it on <body>;
  // put it back so keyboard users (and an open dialog) keep their place.
  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy to clipboard is not available in this browser.");
    }
  } finally {
    document.body.removeChild(ta);
    previouslyFocused?.focus({ preventScroll: true });
  }
}
