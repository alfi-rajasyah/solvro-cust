import type { Readable } from "node:stream";

export interface StoredObjectInfo {
  key: string;
  lastModified: Date;
}

export interface StorageGet {
  stream: Readable;
  /** Bytes, when the driver knows it without reading the body. */
  size?: number | undefined;
}

/**
 * One small interface per storage backend (docs/archive/plans/task-attachments.md,
 * D3). A new driver is one new file; the data model does not change.
 */
export interface AttachmentStorage {
  put(key: string, body: Readable, size: number, contentType: string): Promise<void>;
  /** Throws {@link StorageNotFoundError} when the key does not exist. */
  get(key: string): Promise<StorageGet>;
  /** Idempotent: deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
  list(): AsyncIterable<StoredObjectInfo>;
}

export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`Stored object not found: ${key}`);
    this.name = "StorageNotFoundError";
  }
}

