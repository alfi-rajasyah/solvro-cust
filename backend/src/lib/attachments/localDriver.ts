import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  StorageNotFoundError,
  type AttachmentStorage,
  type StorageGet,
  type StoredObjectInfo,
} from "./types.js";

const TEMP_SUFFIX = ".part";

export function createLocalDriver(rootDir: string): AttachmentStorage {
  const root = path.resolve(rootDir);

  /** Resolves a key under the root, refusing anything that escapes it. */
  function resolveKey(key: string): string {
    if (!key || key.includes("\0")) throw new Error("Invalid storage key");
    const full = path.resolve(root, key);
    if (full === root || !full.startsWith(root + path.sep)) {
      throw new Error("Invalid storage key");
    }
    return full;
  }

  async function* walk(dir: string): AsyncGenerator<string> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) yield* walk(full);
      else if (entry.isFile()) yield full;
    }
  }

  return {
    async put(key, body: Readable) {
      const target = resolveKey(key);
      await mkdir(path.dirname(target), { recursive: true });
      const temp = `${target}.${randomUUID()}${TEMP_SUFFIX}`;
      try {
        await pipeline(body, createWriteStream(temp));
        await rename(temp, target);
      } catch (err) {
        await rm(temp, { force: true });
        throw err;
      }
    },

    async get(key): Promise<StorageGet> {
      const target = resolveKey(key);
      let info;
      try {
        info = await stat(target);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new StorageNotFoundError(key);
        throw err;
      }
      if (!info.isFile()) throw new StorageNotFoundError(key);
      return { stream: createReadStream(target), size: info.size };
    },

    async delete(key) {
      await rm(resolveKey(key), { force: true });
    },

    async *list(): AsyncGenerator<StoredObjectInfo> {
      for await (const file of walk(path.join(root, "tasks"))) {
        // An in-flight upload's temp file is not a stored object yet.
        if (file.endsWith(TEMP_SUFFIX)) continue;
        let info;
        try {
          info = await stat(file);
        } catch (err) {
          // Deleted between the directory read and the stat.
          if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw err;
        }
        yield {
          key: path.relative(root, file).split(path.sep).join("/"),
          lastModified: info.mtime,
        };
      }
    },
  };
}
