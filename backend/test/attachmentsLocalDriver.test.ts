import { mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalDriver } from "../src/lib/attachments/localDriver.js";
import { StorageNotFoundError, type AttachmentStorage } from "../src/lib/attachments/types.js";

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

describe("local attachment driver", () => {
  let root: string;
  let storage: AttachmentStorage;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "solvro-att-"));
    storage = createLocalDriver(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("puts, gets, lists and deletes a file", async () => {
    await storage.put("tasks/7/abc", Readable.from([Buffer.from("hello")]), 5, "text/plain");
    const got = await storage.get("tasks/7/abc");
    expect(got.size).toBe(5);
    expect(await readAll(got.stream)).toBe("hello");

    const keys: string[] = [];
    for await (const item of storage.list()) {
      keys.push(item.key);
      expect(item.lastModified).toBeInstanceOf(Date);
    }
    expect(keys).toEqual(["tasks/7/abc"]);

    await storage.delete("tasks/7/abc");
    await expect(storage.get("tasks/7/abc")).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  it("treats deleting a missing key as success", async () => {
    await expect(storage.delete("tasks/1/missing")).resolves.toBeUndefined();
  });

  it("rejects keys that escape the root", async () => {
    for (const key of ["../evil", "tasks/../../evil", "/etc/passwd", "", ".", "a\0b"]) {
      await expect(storage.put(key, Readable.from(["x"]), 1, "text/plain")).rejects.toThrow(
        "Invalid storage key",
      );
      await expect(storage.get(key)).rejects.toThrow("Invalid storage key");
      await expect(storage.delete(key)).rejects.toThrow("Invalid storage key");
    }
    // A sibling folder sharing the root's name prefix is not inside the root.
    await expect(storage.get(`../${path.basename(root)}-sibling/x`)).rejects.toThrow(
      "Invalid storage key",
    );
  });

  it("leaves no temp file behind when the source stream fails", async () => {
    const failing = new Readable({
      read() {
        this.destroy(new Error("boom"));
      },
    });
    await expect(storage.put("tasks/2/x", failing, 1, "text/plain")).rejects.toThrow("boom");
    const left = await readdir(path.join(root, "tasks", "2"));
    expect(left).toEqual([]);
  });

  it("lists only keys under tasks/", async () => {
    await writeFile(path.join(root, "stray.txt"), "x");
    await storage.put("tasks/4/k", Readable.from(["x"]), 1, "text/plain");
    const keys: string[] = [];
    for await (const item of storage.list()) keys.push(item.key);
    expect(keys).toEqual(["tasks/4/k"]);
  });

  it("lists nothing for an empty or missing root and skips in-flight temp files", async () => {
    const empty = createLocalDriver(path.join(root, "nope"));
    const none: string[] = [];
    for await (const item of empty.list()) none.push(item.key);
    expect(none).toEqual([]);

    await mkdir(path.join(root, "tasks", "3"), { recursive: true });
    await writeFile(path.join(root, "tasks", "3", "k.1234.part"), "partial");
    await writeFile(path.join(root, "tasks", "3", "k"), "done");
    const keys: string[] = [];
    for await (const item of storage.list()) keys.push(item.key);
    expect(keys).toEqual(["tasks/3/k"]);
  });
});
