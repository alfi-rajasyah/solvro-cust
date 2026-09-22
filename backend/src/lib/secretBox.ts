// Secrets-at-rest helper for third-party integration tokens (iTop app/personal
// tokens, webhook secrets, …). AES-256-GCM via node:crypto, keyed by
// env.SECRETS_KEY (a base64 string decoding to exactly 32 bytes — validated
// in src/env.ts). Sealed format: "v1:<base64 iv>:<base64 tag>:<base64 ciphertext>".
// See docs/archive/plans/itop-integration.md §3 for the wider integration design.
import crypto from "node:crypto";

import { env } from "../env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const FORMAT_VERSION = "v1";

/** Thrown by `open()` on malformed input, a tampered tag/ciphertext, or the wrong key. Never carries plaintext. */
export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

function getKey(): Buffer {
  return Buffer.from(env.SECRETS_KEY, "base64");
}

/** Encrypts `plain` with a fresh random IV. Never throws on well-formed input. */
export function seal(plain: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Decrypts a value produced by `seal()`. Throws `SecretBoxError` on any failure — never logs or includes plaintext. */
export function open(sealed: string): string {
  const parts = sealed.split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new SecretBoxError("Invalid secret format: unrecognized prefix or shape");
  }

  const [, ivB64, tagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  if (iv.length !== IV_LENGTH) {
    throw new SecretBoxError("Invalid secret format: unexpected IV length");
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    // Wrong key, tampered ciphertext, or tampered tag all surface as the
    // same GCM authentication failure — never distinguish or log details.
    throw new SecretBoxError("Failed to decrypt secret: tampered data or wrong key");
  }
}
