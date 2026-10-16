// Writes OutlineMention rows from an Outline webhook delivery
// (docs/archive/plans/outline-integration.md, D4 / B5). The page text is parsed in
// memory by extractSolvroLinks and dropped: only the doc id, title, Outline's
// RELATIVE path (F8) and the Solvro ids found are ever stored.
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { extractSolvroLinks } from "./mentionLinks.js";

export interface OutlineDocSnapshot {
  docId: string;
  title: string;
  /** Outline's relative path, e.g. `/doc/plan-AbC123`. */
  docPath: string;
  /** Markdown; read once for link extraction and never stored. */
  text: string;
}

const MAX_TITLE = 500;
const MAX_PATH = 1000;

/** Outline's relative `url` (F8) as a stored path; an absolute URL is reduced to its path. */
export function toRelativeDocPath(url: unknown, fallbackId: string): string {
  const fallback = `/doc/${encodeURIComponent(fallbackId)}`;
  if (typeof url !== "string" || url === "") return fallback;
  let path = url.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      const parsed = new URL(path);
      path = parsed.pathname + parsed.search;
    } catch {
      return fallback;
    }
  }
  if (!path.startsWith("/") || path.startsWith("//") || path.length > MAX_PATH) return fallback;
  return path;
}

export function clampTitle(title: unknown): string {
  return typeof title === "string" ? title.slice(0, MAX_TITLE) : "";
}

/** Removes every mention of a page (deleted, archived, unpublished). Returns the rows removed. */
export async function deleteDocMentions(docId: string): Promise<number> {
  const { count } = await prisma.outlineMention.deleteMany({ where: { outlineDocId: docId } });
  return count;
}

async function syncOnce(doc: OutlineDocSnapshot, appOrigin: string): Promise<void> {
  const links = extractSolvroLinks(doc.text, appOrigin);

  await prisma.$transaction(async (tx) => {
    // Serialise deliveries for one page: two updates ~4 s apart can overlap, and
    // an interleaved delete+insert would otherwise leave a stale set.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"outline-mentions:" + doc.docId}))`;

    // Only ids that exist (the FK would reject others) and tasks that really
    // belong to the project named in the link.
    const [projects, tasks] = await Promise.all([
      links.projectIds.length
        ? tx.project.findMany({ where: { id: { in: links.projectIds } }, select: { id: true } })
        : [],
      links.tasks.length
        ? tx.task.findMany({
            where: { id: { in: links.tasks.map((t) => t.taskId) } },
            select: { id: true, projectId: true },
          })
        : [],
    ]);
    const existingProjects = new Set(projects.map((p) => p.id));
    const taskProject = new Map(tasks.map((t) => [t.id, t.projectId]));

    const wantedProjects = links.projectIds.filter((id) => existingProjects.has(id));
    const wantedTasks = [
      ...new Set(
        links.tasks.filter((t) => taskProject.get(t.taskId) === t.projectId).map((t) => t.taskId),
      ),
    ];

    const current = await tx.outlineMention.findMany({
      where: { outlineDocId: doc.docId },
      select: { id: true, projectId: true, taskId: true },
    });
    const stale = current.filter((row) =>
      row.taskId !== null ? !wantedTasks.includes(row.taskId) : !wantedProjects.includes(row.projectId as number),
    );
    if (stale.length > 0) {
      await tx.outlineMention.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
    }

    const rows = [
      ...wantedProjects.map((projectId) => ({
        outlineDocId: doc.docId,
        docTitle: doc.title,
        docPath: doc.docPath,
        projectId,
        taskId: null,
      })),
      ...wantedTasks.map((taskId) => ({
        outlineDocId: doc.docId,
        docTitle: doc.title,
        docPath: doc.docPath,
        projectId: null,
        taskId,
      })),
    ];
    if (rows.length > 0) {
      await tx.outlineMention.createMany({ data: rows, skipDuplicates: true });
    }
    // A retitled / moved page keeps its rows: refresh the display fields only
    // when they changed (rows just created already match).
    await tx.outlineMention.updateMany({
      where: {
        outlineDocId: doc.docId,
        OR: [{ docTitle: { not: doc.title } }, { docPath: { not: doc.docPath } }],
      },
      data: { docTitle: doc.title, docPath: doc.docPath },
    });
  });
}

/**
 * Recomputes the mentions of one published page so the table matches its
 * current links: rows for links no longer present are deleted, new ones added.
 */
export async function syncDocMentions(doc: OutlineDocSnapshot, appOrigin: string): Promise<void> {
  try {
    await syncOnce(doc, appOrigin);
  } catch (err) {
    // A project/task deleted between the existence check and the insert: the
    // retry sees it gone. Anything else is a real failure.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      await syncOnce(doc, appOrigin);
      return;
    }
    throw err;
  }
}
