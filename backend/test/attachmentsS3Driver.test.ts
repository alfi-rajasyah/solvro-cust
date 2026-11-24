import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { createS3Driver, type S3Like } from "../src/lib/attachments/s3Driver.js";
import { StorageNotFoundError } from "../src/lib/attachments/types.js";

const config = {
  endpoint: "http://silo.test:9000",
  region: "us-east-1",
  bucket: "solvro-test",
  accessKeyId: "k",
  secretAccessKey: "s",
  forcePathStyle: true,
};

function s3Error(name: string, status: number) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
}

describe("S3 attachment driver", () => {
  it("uploads through the injected upload with bucket, key and content type", async () => {
    const done = vi.fn().mockResolvedValue({});
    const upload = vi.fn().mockReturnValue({ done });
    const driver = createS3Driver(config, { client: { send: vi.fn() }, upload });
    const body = Readable.from(["x"]);
    await driver.put("tasks/1/a", body, 1, "text/plain");
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "solvro-test",
        key: "tasks/1/a",
        body,
        contentType: "text/plain",
      }),
    );
    expect(done).toHaveBeenCalledOnce();
  });

  it("gets a stream and the size", async () => {
    const send = vi.fn().mockResolvedValue({ Body: Readable.from(["abc"]), ContentLength: 3 });
    const driver = createS3Driver(config, { client: { send } });
    const got = await driver.get("tasks/1/a");
    expect(got.size).toBe(3);
    const cmd = send.mock.calls[0]![0] as GetObjectCommand;
    expect(cmd).toBeInstanceOf(GetObjectCommand);
    expect(cmd.input).toEqual({ Bucket: "solvro-test", Key: "tasks/1/a" });
  });

  it("maps a missing key to StorageNotFoundError and rethrows other errors", async () => {
    const missing = createS3Driver(config, {
      client: { send: vi.fn().mockRejectedValue(s3Error("NoSuchKey", 404)) },
    });
    await expect(missing.get("k")).rejects.toBeInstanceOf(StorageNotFoundError);

    const broken = createS3Driver(config, {
      client: { send: vi.fn().mockRejectedValue(s3Error("InternalError", 500)) },
    });
    await expect(broken.get("k")).rejects.toThrow("InternalError");
    await expect(broken.delete("k")).rejects.toThrow("InternalError");
  });

  it("deletes, treating a missing key as success", async () => {
    const send = vi.fn().mockResolvedValue({});
    const driver = createS3Driver(config, { client: { send } });
    await driver.delete("tasks/1/a");
    const cmd = send.mock.calls[0]![0] as DeleteObjectCommand;
    expect(cmd).toBeInstanceOf(DeleteObjectCommand);
    expect(cmd.input).toEqual({ Bucket: "solvro-test", Key: "tasks/1/a" });

    const gone = createS3Driver(config, {
      client: { send: vi.fn().mockRejectedValue(s3Error("NoSuchKey", 404)) },
    });
    await expect(gone.delete("tasks/1/a")).resolves.toBeUndefined();
  });

  it("lists every page", async () => {
    const t1 = new Date("2026-01-01T00:00:00Z");
    const t2 = new Date("2026-01-02T00:00:00Z");
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Contents: [{ Key: "tasks/1/a", LastModified: t1 }],
        IsTruncated: true,
        NextContinuationToken: "tok",
      })
      .mockResolvedValueOnce({ Contents: [{ Key: "tasks/2/b", LastModified: t2 }], IsTruncated: false });
    const driver = createS3Driver(config, { client: { send } as S3Like });
    const items = [];
    for await (const item of driver.list()) items.push(item);
    expect(items).toEqual([
      { key: "tasks/1/a", lastModified: t1 },
      { key: "tasks/2/b", lastModified: t2 },
    ]);
    const second = send.mock.calls[1]![0] as ListObjectsV2Command;
    expect(second.input.ContinuationToken).toBe("tok");
  });

  it("prefixes every key, lists only under <prefix>tasks/ and strips the prefix", async () => {
    const t = new Date("2026-01-01T00:00:00Z");
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Body: Readable.from(["a"]), ContentLength: 1 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Contents: [{ Key: "env1/tasks/1/a", LastModified: t }] });
    const upload = vi.fn().mockReturnValue({ done: vi.fn().mockResolvedValue({}) });
    const driver = createS3Driver({ ...config, keyPrefix: "env1/" }, { client: { send }, upload });
    await driver.put("tasks/1/a", Readable.from(["x"]), 1, "text/plain");
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ key: "env1/tasks/1/a" }));
    await driver.get("tasks/1/a");
    expect((send.mock.calls[0]![0] as GetObjectCommand).input.Key).toBe("env1/tasks/1/a");
    await driver.delete("tasks/1/a");
    expect((send.mock.calls[1]![0] as DeleteObjectCommand).input.Key).toBe("env1/tasks/1/a");
    const items = [];
    for await (const item of driver.list()) items.push(item);
    expect((send.mock.calls[2]![0] as ListObjectsV2Command).input.Prefix).toBe("env1/tasks/");
    expect(items).toEqual([{ key: "tasks/1/a", lastModified: t }]);
  });

  it("lists under tasks/ with no prefix configured", async () => {
    const send = vi.fn().mockResolvedValue({ Contents: [] });
    const driver = createS3Driver(config, { client: { send } });
    for await (const _ of driver.list()) void _;
    expect((send.mock.calls[0]![0] as ListObjectsV2Command).input.Prefix).toBe("tasks/");
  });
});
