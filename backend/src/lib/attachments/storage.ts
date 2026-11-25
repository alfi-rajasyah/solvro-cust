import { env } from "../../env.js";
import { createLocalDriver } from "./localDriver.js";
import { createS3Driver } from "./s3Driver.js";
import type { AttachmentStorage } from "./types.js";

export {
  StorageNotFoundError,
  type AttachmentStorage,
  type StorageGet,
  type StoredObjectInfo,
} from "./types.js";

let instance: AttachmentStorage | undefined;

export function getStorage(): AttachmentStorage {
  if (instance) return instance;
  if (env.ATTACHMENTS_DRIVER === "s3") {
    // env.ts has already refused to start without these.
    instance = createS3Driver({
      endpoint: env.S3_ENDPOINT,
      keyPrefix: env.S3_KEY_PREFIX,
      region: env.S3_REGION as string,
      bucket: env.S3_BUCKET as string,
      accessKeyId: env.S3_ACCESS_KEY_ID as string,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY as string,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  } else {
    instance = createLocalDriver(env.ATTACHMENTS_DIR);
  }
  return instance;
}
