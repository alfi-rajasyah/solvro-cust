// Pure extraction of Solvro links from an Outline page's markdown
// (docs/archive/plans/outline-integration.md, D4 / B5). Finds every http(s) URL
// in the text - markdown links, autolinks, bare URLs - keeps those whose origin is
// the Solvro app origin, and classifies them:
//   /projects/<id>[/<tab>]            -> project-level mention
//   /projects/<id>[/<tab>]?task=<tid> -> task-level mention (the caller must still
//                                        check the task exists in that project)
// Anything else (other origins, deeper paths, malformed ids, a malformed ?task=)
// is ignored. No page text leaves this function: only numeric ids do.

export interface SolvroLinks {
  projectIds: number[];
  tasks: Array<{ projectId: number; taskId: number }>;
}

const MAX_ID = 2_147_483_647; // Postgres INTEGER
// A URL runs to the first whitespace, angle bracket, parenthesis, square bracket,
// quote or backslash (markdown escapes); a closing `)` or `>` therefore ends it.
const URL_CANDIDATE = /https?:\/\/[^\s<>()[\]"'`\\]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?*_~=&|]+$/;

function parseId(raw: string | null): number | null {
  if (raw === null || !/^[1-9]\d{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= MAX_ID ? n : null;
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Classifies one candidate URL, or null when it is not a Solvro project/task link. */
function classify(candidate: string, appOrigin: string): { projectId: number; taskId: number | null } | null {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.origin !== appOrigin) return null;

  const segments: string[] = [];
  for (const raw of url.pathname.split("/")) {
    if (raw === "") continue;
    const decoded = decodeSegment(raw);
    if (decoded === null) return null;
    segments.push(decoded);
  }
  // /projects/<id> or /projects/<id>/<tab>
  if (segments.length < 2 || segments.length > 3 || segments[0] !== "projects") return null;
  if (segments.length === 3 && !/^[a-z][a-z-]{0,30}$/i.test(segments[2])) return null;
  const projectId = parseId(segments[1]);
  if (projectId === null) return null;

  const taskParam = url.searchParams.get("task");
  if (taskParam === null) return { projectId, taskId: null };
  const taskId = parseId(taskParam);
  return taskId === null ? null : { projectId, taskId };
}

export function extractSolvroLinks(markdown: string, appOrigin: string): SolvroLinks {
  const projectIds = new Set<number>();
  const tasks = new Map<string, { projectId: number; taskId: number }>();

  for (const match of markdown.matchAll(URL_CANDIDATE)) {
    const candidate = match[0].replace(/&amp;/gi, "&").replace(TRAILING_PUNCTUATION, "");
    const link = classify(candidate, appOrigin);
    if (!link) continue;
    if (link.taskId === null) projectIds.add(link.projectId);
    else tasks.set(`${link.projectId}:${link.taskId}`, { projectId: link.projectId, taskId: link.taskId });
  }

  return {
    projectIds: [...projectIds],
    tasks: [...tasks.values()],
  };
}
