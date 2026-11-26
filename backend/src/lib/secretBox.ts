// Secrets-at-rest helper for third-party integration tokens (iTop app/personal
// tokens, webhook secrets, …). AES-256-GCM via node:crypto, keyed by
// env.SECRETS_KEY (a base64 string decoding to exactly 32 bytes — validated
// in src/env.ts).
//
// Sealed formats:
//   v2 (written): "v2:<key id>:<base64 iv>:<base64 tag>:<base64 ciphertext>"
//     The key id is the first 4 bytes of SHA-256(key) in hex. It also binds the
//     ciphertext as GCM additional data, so a rewritten key id fails to open.
//   v1 (read only): "v1:<base64 iv>:<base64 tag>:<base64 ciphertext>" — no key
//     id, so open() tries the current key, then the previous one.
// To rotate SECRETS_KEY, set the old key as SECRETS_KEY_PREVIOUS: open() reads
// values sealed under either key, seal() always uses the current one.
// See docs/archive/plans/itop-integration.md §3 for the wider integration design.
import crypto from "node:crypto";

import { env } from "../env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const LEGACY_VERSION = "v1";
const FORMAT_VERSION = "v2";

/** Thrown by `open()` on malformed input, a tampered tag/ciphertext, or the wrong key. Never carries plaintext. */
export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

interface KeyEntry {
  id: string;
  key: Buffer;
}

function toEntry(base64Key: string): KeyEntry {
  const key = Buffer.from(base64Key, "base64");
  return { id: crypto.createHash("sha256").update(key).digest("hex").slice(0, 8), key };
}

export interface SecretBox {
  seal(plain: string): string;
  open(sealed: string): string;
}

/** Builds a box over a current key and an optional previous key (both base64, 32 bytes). */
export function createSecretBox(currentKey: string, previousKey?: string): SecretBox {
  const current = toEntry(currentKey);
  const previous = previousKey ? toEntry(previousKey) : undefined;
  const candidates = previous && previous.id !== current.id ? [current, previous] : [current];

  function decrypt(entry: KeyEntry, iv: Buffer, tag: Buffer, ciphertext: Buffer, aad?: string): string {
    const decipher = crypto.createDecipheriv(ALGORITHM, entry.key, iv, { authTagLength: TAG_LENGTH });
    if (aad !== undefined) decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }

  return {
    seal(plain) {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, current.key, iv);
      cipher.setAAD(Buffer.from(current.id, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [
        FORMAT_VERSION,
        current.id,
        iv.toString("base64"),
        tag.toString("base64"),
        ciphertext.toString("base64"),
      ].join(":");
    },

    open(sealed) {
      const parts = sealed.split(":");
      const isV2 = parts[0] === FORMAT_VERSION && parts.length === 5;
      const isV1 = parts[0] === LEGACY_VERSION && parts.length === 4;
      if (!isV1 && !isV2) {
        throw new SecretBoxError("Invalid secret format: unrecognized prefix or shape");
      }

      const keyId = isV2 ? parts[1] : undefined;
      const [ivB64, tagB64, ciphertextB64] = isV2 ? parts.slice(2) : parts.slice(1);
      const iv = Buffer.from(ivB64, "base64");
      const tag = Buffer.from(tagB64, "base64");
      const ciphertext = Buffer.from(ciphertextB64, "base64");

      if (iv.length !== IV_LENGTH) {
        throw new SecretBoxError("Invalid secret format: unexpected IV length");
      }

      if (tag.length !== TAG_LENGTH) {
        throw new SecretBoxError("Invalid secret format: unexpected auth tag length");
      }

      // v2 names its key; v1 carries no id, so every configured key is tried.
      const tryKeys = keyId === undefined ? candidates : candidates.filter((entry) => entry.id === keyId);

      for (const entry of tryKeys) {
        try {
          return decrypt(entry, iv, tag, ciphertext, keyId);
        } catch {
          // Wrong key, tampered ciphertext, or tampered tag all surface as the
          // same GCM authentication failure — never distinguish or log details.
        }
      }
      throw new SecretBoxError("Failed to decrypt secret: tampered data or wrong key");
    },
  };
}

const box = createSecretBox(env.SECRETS_KEY, env.SECRETS_KEY_PREVIOUS);

/** Encrypts `plain` with the current key and a fresh random IV. Never throws on well-formed input. */
export function seal(plain: string): string {
  return box.seal(plain);
}

/** Decrypts a value produced by `seal()`. Throws `SecretBoxError` on any failure — never logs or includes plaintext. */
export function open(sealed: string): string {
  return box.open(sealed);
}
