// Parses a customer/project `outlineUrl` into the Outline page or collection it
// points at (docs/archive/plans/outline-integration.md, B4, F6). Pure: no network.
// Outline paths look like `/doc/<slug>-<urlId>` and `/collection/<slug>-<urlId>`
// (a bare `/doc/<urlId>` or a UUID also resolve), optionally followed by a
// sub-path (`/edit`, `/history`, `/recent`). The link must be on the configured
// Outline's origin - a foreign link is never fetched with the user's token.

export type AnchorKind = "doc" | "collection";

export interface OutlineAnchor {
  kind: AnchorKind;
  /** Outline's short id (10 alphanumerics), or a UUID when the URL carries one. */
  urlId: string;
}

export type AnchorParse =
  | { ok: true; anchor: OutlineAnchor }
  // Valid URL on a different origin than the configured Outline: "points outside your Outline".
  | { ok: false; reason: "outside" }
  // Same origin, but not a page/collection path Solvro can resolve (home, share link, search, ...).
  | { ok: false; reason: "unsupported" };

const KIND_BY_SEGMENT: Record<string, AnchorKind> = { doc: "doc", collection: "collection" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The slug part is the title in kebab case; the urlId is the last 10 alphanumerics
// after the final hyphen (or the whole segment when there is no slug).
const URL_ID_TAIL = /(?:^|-)([A-Za-z0-9]{10})$/;

export function parseOutlineAnchor(outlineUrl: string, baseUrl: string): AnchorParse {
  let url: URL;
  let base: URL;
  try {
    url = new URL(outlineUrl);
    base = new URL(baseUrl);
  } catch {
    return { ok: false, reason: "outside" };
  }
  if (url.origin !== base.origin) return { ok: false, reason: "outside" };

  // Outline may live under a path prefix (https://acme.com/wiki): strip it.
  const prefix = base.pathname.replace(/\/+$/, "");
  let path = url.pathname;
  if (prefix !== "") {
    if (path !== prefix && !path.startsWith(`${prefix}/`)) return { ok: false, reason: "outside" };
    path = path.slice(prefix.length);
  }

  const [kindSegment, idSegment] = path.split("/").filter((s) => s !== "");
  const kind = kindSegment ? KIND_BY_SEGMENT[kindSegment] : undefined;
  if (!kind || !idSegment) return { ok: false, reason: "unsupported" };

  let segment: string;
  try {
    segment = decodeURIComponent(idSegment);
  } catch {
    return { ok: false, reason: "unsupported" };
  }
  if (UUID.test(segment)) return { ok: true, anchor: { kind, urlId: segment.toLowerCase() } };
  const m = URL_ID_TAIL.exec(segment);
  if (!m) return { ok: false, reason: "unsupported" };
  return { ok: true, anchor: { kind, urlId: m[1] } };
}

/** `baseUrl` + an Outline-relative path (F8: Outline returns `/doc/...`); null when it is not a plain path. */
export function absoluteOutlineUrl(baseUrl: string, path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return null;
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}
