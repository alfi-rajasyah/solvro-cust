// What an incoming body means (docs/archive/plans/webhooks.md, Phase 2): the
// "Solvro JSON" mode (a top-level `solvro` key) or the link scanner (any other
// body). Both end as a list of comment candidates; the writer decides which
// tasks belong to the hook's project.
import crypto from "node:crypto";
import { HttpError } from "../../http/errors.js";
import type { InboundBody } from "./parse.js";

/** Distinct tasks of the hook's project one request may comment on (applied by the writer). */
export const MAX_TASKS_PER_REQUEST = 20;
/** Comments one request may write; a push of hundreds of commits must not flood a thread (applied by the writer). */
export const MAX_COMMENTS_PER_REQUEST = 100;
/** Candidates the scanner keeps before the writer narrows them to the hook's project. */
const MAX_CANDIDATES = 5000;
const MAX_DEPTH = 20;
/** Task ids are INT4 columns. */
const MAX_TASK_ID = 2_147_483_647;
const MAX_STRINGS = 5000;
const MAX_LINE = 200;
const MAX_SOLVRO_TEXT = 2000;
const SOURCE_LINK_FIELDS = ["url", "html_url", "web_url"] as const;

export interface CommentCandidate {
  taskId: number;
  body: string;
  /** The source link, or the SHA-256 of the first line when there is none. */
  sourceKey: string;
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches `<APP_URL>/tasks/<id>` and captures the id; null without APP_URL. */
function taskUrlPattern(appUrl: string | null): RegExp | null {
  if (!appUrl) return null;
  return new RegExp(`${escapeRegExp(appUrl.replace(/\/+$/, ""))}/tasks/(\\d{1,9})(?![\\w])`, "gi");
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return Array.from(line.trim()).slice(0, MAX_LINE).join("");
}

function taskIdsIn(text: string, pattern: RegExp): number[] {
  const ids: number[] = [];
  for (const m of text.matchAll(pattern)) ids.push(Number(m[1]));
  return ids;
}

function solvroCandidates(value: unknown, appUrl: string | null): CommentCandidate[] {
  const fail = (reason: string): never => {
    throw new HttpError(400, "invalid_solvro_body", reason);
  };
  const spec = (value as { solvro?: unknown }).solvro;
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) fail("`solvro` must be an object");
  const { task, text, url } = spec as Record<string, unknown>;

  let taskId: number | null = null;
  if (typeof task === "number") taskId = Number.isInteger(task) && task >= 1 && task <= MAX_TASK_ID ? task : fail("`solvro.task` must be a whole number from 1 to 2147483647");
  else if (typeof task === "string" && /^\d{1,10}$/.test(task.trim())) {
    taskId = Number(task.trim());
    if (taskId < 1 || taskId > MAX_TASK_ID) fail("`solvro.task` must be a whole number from 1 to 2147483647");
  }
  else if (typeof task === "string") {
    const pattern = taskUrlPattern(appUrl);
    taskId = pattern ? (taskIdsIn(task.trim(), pattern)[0] ?? null) : null;
    if (taskId === null) fail("`solvro.task` must be a task id or a task URL of this Solvro");
  } else fail("`solvro.task` is required: a task id or a task URL");

  if (typeof text !== "string" || text.trim() === "") fail("`solvro.text` is required");
  if ((text as string).length > MAX_SOLVRO_TEXT) fail(`\`solvro.text\` is longer than ${MAX_SOLVRO_TEXT} characters`);
  if (url !== undefined && url !== null && !isHttpUrl(url)) fail("`solvro.url` must be an http(s) URL");

  const body = (text as string).trim();
  const link = typeof url === "string" ? url : null;
  return [
    {
      taskId: taskId as number,
      body: link ? `${body} · ${link}` : body,
      sourceKey: link ?? sha256(firstLine(body)),
    },
  ];
}

function scanCandidates(body: InboundBody, appUrl: string | null): CommentCandidate[] {
  const pattern = taskUrlPattern(appUrl);
  if (!pattern) return [];
  const found = new Map<string, CommentCandidate>();

  const consider = (text: string, link: string | null) => {
    const line = firstLine(text);
    if (line === "") return;
    for (const taskId of taskIdsIn(text, pattern)) {
      if (found.size >= MAX_CANDIDATES) return;
      const sourceKey = link ?? sha256(line);
      const key = `${taskId}|${sourceKey}`;
      if (found.has(key)) continue;
      found.set(key, { taskId, body: link ? `${line} · ${link}` : line, sourceKey });
    }
  };

  if (body.kind === "text") {
    consider(body.value, null);
    return [...found.values()];
  }

  let strings = 0;
  const walk = (node: unknown, depth: number, owner: Record<string, unknown> | null) => {
    if (strings >= MAX_STRINGS || depth > MAX_DEPTH) return;
    if (typeof node === "string") {
      strings += 1;
      let link: string | null = null;
      if (owner) {
        for (const field of SOURCE_LINK_FIELDS) {
          if (isHttpUrl(owner[field])) {
            link = owner[field] as string;
            break;
          }
        }
      }
      consider(node, link);
    } else if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1, owner);
    } else if (node !== null && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      for (const child of Object.values(obj)) walk(child, depth + 1, obj);
    }
  };
  walk(body.value, 0, null);
  return [...found.values()];
}

/** Turns a parsed body into comment candidates; throws 400 `invalid_solvro_body` for a bad Solvro JSON body. */
export function candidatesFromBody(body: InboundBody, appUrl: string | null): CommentCandidate[] {
  if (
    body.kind === "json" &&
    body.value !== null &&
    typeof body.value === "object" &&
    !Array.isArray(body.value) &&
    Object.prototype.hasOwnProperty.call(body.value, "solvro")
  ) {
    return solvroCandidates(body.value, appUrl);
  }
  return scanCandidates(body, appUrl);
}
