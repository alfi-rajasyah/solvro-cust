// The "Docs" tab backend (docs/archive/plans/outline-integration.md, B4): resolves
// a customer/project `outlineUrl` to its Outline anchor with the VIEWER's token,
// reads the page tree under it, and creates pages beneath it. Everything runs
// through outlineCall (the acting user's own OAuth token, D2). Outline page text is
// never read into the result (D4): nodes are rebuilt from id/title/url only.
import { prisma } from "../../prisma.js";
import { HttpError } from "../../http/errors.js";
import { outlineCall } from "./client.js";
import { absoluteOutlineUrl, parseOutlineAnchor, type AnchorKind } from "./anchor.js";
import { onOutlineAuthChanged } from "./cacheHooks.js";
import { isOutlineHidden, outlineForbidden, outlineNotConnected } from "./errors.js";

export interface DocNode {
  id: string;
  title: string;
  url: string;
  children: DocNode[];
}

export type ResolvedAnchor =
  | { state: "none" }
  | { state: "outside" }
  | { state: "unsupported" }
  | { state: "hidden" }
  | { state: "ok"; kind: AnchorKind; uuid: string; title: string; url: string; tree: DocNode[] };

// F11: all users share Outline's per-IP rate limits, so a user's tree is cached
// briefly. Keyed per user (a tree is permission-filtered) and per anchor.
export const TREE_CACHE_TTL_MS = 60_000;
const TREE_CACHE_MAX = 500;
const treeCache = new Map<string, { expires: number; value: ResolvedAnchor }>();

export function clearOutlineTreeCache(userId?: number): void {
  if (userId === undefined) return void treeCache.clear();
  for (const key of treeCache.keys()) if (key.startsWith(`${userId}|`)) treeCache.delete(key);
}

// A token change (disconnect, new connection, admin wipe) drops the cached trees.
onOutlineAuthChanged((userId) => clearOutlineTreeCache(userId ?? undefined));

const MAX_TREE_DEPTH = 12;
const MAX_TREE_NODES = 2000;

function toNodes(raw: unknown, baseUrl: string, budget: { left: number }, depth = 0): DocNode[] {
  if (!Array.isArray(raw) || depth >= MAX_TREE_DEPTH) return [];
  const out: DocNode[] = [];
  for (const item of raw) {
    if (budget.left <= 0) break;
    const n = item as { id?: unknown; title?: unknown; url?: unknown; children?: unknown };
    if (typeof n?.id !== "string" || typeof n.title !== "string") continue;
    budget.left -= 1;
    out.push({
      id: n.id,
      title: n.title,
      url: absoluteOutlineUrl(baseUrl, n.url) ?? baseUrl,
      children: toNodes(n.children, baseUrl, budget, depth + 1),
    });
  }
  return out;
}

interface InfoData {
  id?: unknown;
  title?: unknown;
  name?: unknown;
  url?: unknown;
  deletedAt?: unknown;
  archivedAt?: unknown;
}

/**
 * Resolves `outlineUrl` for `userId`. `none`/`outside`/`unsupported` need no Outline
 * call (and no connection); anything else needs a connected user (409
 * `outline_not_connected` / `outline_reconnect_required` from outlineCall).
 */
export async function resolveOutlineAnchor(userId: number, outlineUrl: string | null): Promise<ResolvedAnchor> {
  if (!outlineUrl) return { state: "none" };
  const config = await prisma.outlineConfig.findUnique({ where: { id: "default" }, select: { baseUrl: true } });
  const baseUrl = config?.baseUrl?.replace(/\/+$/, "");
  if (!baseUrl) return { state: "outside" };

  const parsed = parseOutlineAnchor(outlineUrl, baseUrl);
  if (!parsed.ok) return { state: parsed.reason };
  const { kind, urlId } = parsed.anchor;

  // Never serve a cached tree to a user who has no Outline connection any more.
  const holder = await prisma.user.findUnique({ where: { id: userId }, select: { outlineAccessTokenEnc: true } });
  if (!holder?.outlineAccessTokenEnc) {
    clearOutlineTreeCache(userId);
    throw outlineNotConnected();
  }

  const cacheKey = `${userId}|${baseUrl}|${kind}|${urlId}`;
  const hit = treeCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;

  const value = await fetchAnchor(userId, baseUrl, kind, urlId);
  if (treeCache.size >= TREE_CACHE_MAX) {
    const oldest = treeCache.keys().next().value;
    if (oldest !== undefined) treeCache.delete(oldest);
  }
  treeCache.set(cacheKey, { expires: Date.now() + TREE_CACHE_TTL_MS, value });
  return value;
}

async function fetchAnchor(userId: number, baseUrl: string, kind: AnchorKind, urlId: string): Promise<ResolvedAnchor> {
  const infoMethod = kind === "doc" ? "documents.info" : "collections.info";
  let info: InfoData;
  try {
    info = (await outlineCall<{ data?: InfoData }>(userId, infoMethod, { id: urlId })).data ?? {};
  } catch (err) {
    // F7: a hidden page/collection is 403, an unknown one 404 - both read as "hidden".
    if (isOutlineHidden(err)) return { state: "hidden" };
    throw err;
  }
  // F7: a trashed document still answers 200 with deletedAt set; archived ones are not browsable either.
  if (typeof info.id !== "string" || info.deletedAt || info.archivedAt) return { state: "hidden" };

  const title = String((kind === "doc" ? info.title : info.name) ?? "");
  const anchorUrl = absoluteOutlineUrl(baseUrl, info.url) ?? baseUrl;
  const treeMethod = kind === "doc" ? "documents.documents" : "collections.documents";
  let treeData: unknown;
  try {
    treeData = (await outlineCall<{ data?: unknown }>(userId, treeMethod, { id: info.id })).data;
  } catch (err) {
    if (isOutlineHidden(err)) return { state: "hidden" };
    throw err;
  }
  const budget = { left: MAX_TREE_NODES };
  // collections.documents returns the top-level pages as an array; documents.documents
  // (verified on a real Outline 1.10.1) returns ONE node - the document itself with
  // its `children` - not an array.
  const rawChildren = kind === "doc" && !Array.isArray(treeData) ? (treeData as { children?: unknown } | null)?.children : treeData;
  const children = toNodes(rawChildren, baseUrl, budget);
  // A doc anchor is shown as the root of its own subtree; a collection's top-level pages are the roots.
  const tree: DocNode[] =
    kind === "doc" ? [{ id: info.id, title, url: anchorUrl, children }] : children;
  return { state: "ok", kind, uuid: info.id, title, url: anchorUrl, tree };
}

/** Every node id in the tree (for "parent must belong to the anchor's tree"). */
export function treeIds(tree: DocNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: DocNode[]) => {
    for (const n of nodes) {
      ids.add(n.id);
      walk(n.children);
    }
  };
  walk(tree);
  return ids;
}

export interface CreateDocInput {
  title: string;
  templateId?: string;
  parentDocumentId?: string;
  publish: boolean;
}

/** Creates a page under the anchor as `userId`; returns only { id, title, url }. */
export async function createOutlineDoc(
  userId: number,
  outlineUrl: string | null,
  input: CreateDocInput,
): Promise<{ id: string; title: string; url: string }> {
  const anchor = await resolveOutlineAnchor(userId, outlineUrl);
  if (anchor.state === "none") {
    throw new HttpError(400, "outline_no_anchor", "Add an Outline link before creating pages from here.");
  }
  if (anchor.state === "outside" || anchor.state === "unsupported") {
    throw new HttpError(400, "outline_anchor_invalid", "The Outline link does not point at a page or collection in your Outline.");
  }
  if (anchor.state === "hidden") throw outlineForbidden();

  const body: Record<string, unknown> = { title: input.title, publish: input.publish };
  if (input.templateId) body.templateId = input.templateId;
  if (input.parentDocumentId) {
    if (!treeIds(anchor.tree).has(input.parentDocumentId)) {
      throw new HttpError(
        400,
        "outline_parent_outside_anchor",
        "The parent page is not inside the linked Outline page or collection.",
      );
    }
    body.parentDocumentId = input.parentDocumentId;
  } else if (anchor.kind === "collection") {
    body.collectionId = anchor.uuid;
  } else {
    body.parentDocumentId = anchor.uuid; // default parent of a doc anchor: the anchor itself
  }

  const created = (await outlineCall<{ data?: { id?: unknown; title?: unknown; url?: unknown } }>(userId, "documents.create", body)).data;
  const config = await prisma.outlineConfig.findUnique({ where: { id: "default" }, select: { baseUrl: true } });
  const baseUrl = config?.baseUrl?.replace(/\/+$/, "") ?? "";
  clearOutlineTreeCache(userId);
  if (typeof created?.id !== "string") {
    throw new HttpError(502, "outline_unavailable", "Outline could not be reached.");
  }
  return {
    id: created.id,
    title: typeof created.title === "string" ? created.title : input.title,
    url: absoluteOutlineUrl(baseUrl, created.url) ?? baseUrl,
  };
}
