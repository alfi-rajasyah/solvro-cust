import { randomUUID } from "node:crypto";

// Content-Type comes from the extension, never from the browser (docs/archive/plans/task-attachments.md, D6).
// An allowlisted extension missing here falls back to octet-stream, which
// downloads as an opaque file.
const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  log: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  zip: "application/zip",
};

const FALLBACK_MIME = "application/octet-stream";
const MAX_NAME_LENGTH = 200;
const FALLBACK_NAME = "file";

/** Lower-case extension without the dot, or "" when the name has none. */
export function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function isAllowedExtension(fileName: string, allowed: readonly string[]): boolean {
  const ext = extensionOf(fileName);
  return ext !== "" && allowed.includes(ext);
}

export function mimeTypeFor(fileName: string): string {
  return MIME_BY_EXTENSION[extensionOf(fileName)] ?? FALLBACK_MIME;
}

/**
 * Cleans an uploaded file name for storage in the database and for the
 * Content-Disposition header: drops directory parts and control characters,
 * collapses whitespace, caps the length while keeping the extension.
 */
export function cleanFileName(raw: string): string {
  let name = raw.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ");
  name = name.replace(/\s+/g, " ").trim();
  // A name made only of dots ("..", "...") is not a usable file name.
  if (name === "" || /^\.+$/.test(name)) return FALLBACK_NAME;
  if (name.length > MAX_NAME_LENGTH) {
    const ext = extensionOf(name);
    const suffix = ext ? `.${ext}` : "";
    const stem = name.slice(0, name.length - suffix.length);
    name = stem.slice(0, Math.max(1, MAX_NAME_LENGTH - suffix.length)).trimEnd() + suffix;
  }
  return name;
}

/** Storage key for a new attachment (docs/archive/plans/task-attachments.md, D4): the user's file name never appears in it. */
export function storageKeyFor(taskId: number | string): string {
  return `tasks/${taskId}/${randomUUID()}`;
}
