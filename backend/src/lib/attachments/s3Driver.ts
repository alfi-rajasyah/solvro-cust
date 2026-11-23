import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import {
  StorageNotFoundError,
  type AttachmentStorage,
  type StorageGet,
  type StoredObjectInfo,
} from "./types.js";

export interface S3DriverConfig {
  endpoint?: string | undefined;
  /** Key namespace inside the bucket, with one trailing "/" (or undefined). */
  keyPrefix?: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/** The slice of S3Client the driver uses; tests inject a fake. */
export interface S3Like {
  send(command: unknown): Promise<unknown>;
}

type UploadFactory = (params: {
  client: S3Like;
  bucket: string;
  key: string;
  body: Readable;
  contentType: string;
}) => { done(): Promise<unknown> };

const defaultUpload: UploadFactory = ({ client, bucket, key, body, contentType }) =>
  new Upload({
    client: client as S3Client,
    params: { Bucket: bucket, Key: key, Body: body, ContentType: contentType },
  });

function errorName(err: unknown): string {
  return typeof err === "object" && err !== null && "name" in err ? String(err.name) : "";
}

function errorStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return meta?.httpStatusCode;
}

export function createS3Driver(
  config: S3DriverConfig,
  deps: { client?: S3Like; upload?: UploadFactory } = {},
): AttachmentStorage {
  const client: S3Like =
    deps.client ??
    new S3Client({
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      // S3-compatible stores (Garage, older MinIO/Ceph) reject the SDK's
      // default always-on checksums.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  const makeUpload = deps.upload ?? defaultUpload;
  const Bucket = config.bucket;
  const prefix = config.keyPrefix ?? "";
  const full = (key: string) => prefix + key;

  return {
    async put(key, body, _size, contentType) {
      // Upload streams the body and switches to multipart for large files, so
      // a body of unknown length is fine; `size` is not needed here.
      await makeUpload({ client, bucket: Bucket, key: full(key), body, contentType }).done();
    },

    async get(key): Promise<StorageGet> {
      try {
        const out = (await client.send(new GetObjectCommand({ Bucket, Key: full(key) }))) as {
          Body?: unknown;
          ContentLength?: number;
        };
        if (!out.Body) throw new StorageNotFoundError(key);
        return { stream: out.Body as Readable, size: out.ContentLength };
      } catch (err) {
        if (err instanceof StorageNotFoundError) throw err;
        if (errorName(err) === "NoSuchKey" || errorStatus(err) === 404) {
          throw new StorageNotFoundError(key);
        }
        throw err;
      }
    },

    async delete(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket, Key: full(key) }));
      } catch (err) {
        if (errorName(err) === "NoSuchKey" || errorStatus(err) === 404) return;
        throw err;
      }
    },

    async *list(): AsyncGenerator<StoredObjectInfo> {
      let token: string | undefined;
      do {
        const out = (await client.send(
          new ListObjectsV2Command({ Bucket, Prefix: `${prefix}tasks/`, ContinuationToken: token }),
        )) as {
          Contents?: { Key?: string; LastModified?: Date }[];
          IsTruncated?: boolean;
          NextContinuationToken?: string;
        };
        for (const item of out.Contents ?? []) {
          if (item.Key && item.LastModified) {
            yield { key: item.Key.slice(prefix.length), lastModified: item.LastModified };
          }
        }
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
    },
  };
}
