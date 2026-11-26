// Pure-helper suite — no DB. Exercises backend/src/lib/secretBox.ts against
// the fixed 32-byte SECRETS_KEY provided by test/env.ts.
import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { createSecretBox, open, seal, SecretBoxError } from "../src/lib/secretBox.js";

const TEST_KEY = process.env.SECRETS_KEY as string;

/** Builds a value in the legacy v1 wire format (no key id), as already stored in databases. */
function legacySeal(plain: string, base64Key: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(base64Key, "base64"), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

describe("secretBox", () => {
  it("round-trips a plain string", () => {
    const plain = "super-secret-itop-token";
    expect(open(seal(plain))).toBe(plain);
  });

  it("round-trips unicode content", () => {
    const plain = "hasło żółć – 日本語 🔒";
    expect(open(seal(plain))).toBe(plain);
  });

  it("round-trips an empty string", () => {
    expect(open(seal(""))).toBe("");
  });

  it("produces a different sealed value each call (random IV)", () => {
    const plain = "same-plaintext";
    expect(seal(plain)).not.toBe(seal(plain));
  });

  it("writes the v2:<key id>:<iv>:<tag>:<ciphertext> format", () => {
    const parts = seal("hello").split(":");
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("v2");
    expect(parts[1]).toMatch(/^[0-9a-f]{8}$/);
  });

  it("throws SecretBoxError when the ciphertext is tampered with", () => {
    const sealed = seal("do-not-touch");
    const [version, iv, tag, ciphertext] = legacySeal("do-not-touch", TEST_KEY).split(":");
    const tamperedByte = Buffer.from(ciphertext, "base64");
    tamperedByte[0] = tamperedByte[0] ^ 0xff;
    const tampered = [version, iv, tag, tamperedByte.toString("base64")].join(":");
    expect(() => open(tampered)).toThrow(SecretBoxError);
  });

  it("throws SecretBoxError when the auth tag is tampered with", () => {
    const sealed = seal("do-not-touch");
    const [version, iv, tag, ciphertext] = legacySeal("do-not-touch", TEST_KEY).split(":");
    const tamperedTag = Buffer.from(tag, "base64");
    tamperedTag[0] = tamperedTag[0] ^ 0xff;
    const tampered = [version, iv, tamperedTag.toString("base64"), ciphertext].join(":");
    expect(() => open(tampered)).toThrow(SecretBoxError);
  });

  it("throws SecretBoxError when the auth tag is truncated", () => {
    const sealed = seal("do-not-touch");
    const [version, iv, tag, ciphertext] = legacySeal("do-not-touch", TEST_KEY).split(":");
    const truncated = Buffer.from(tag, "base64").subarray(0, 8);
    expect(() => open([version, iv, truncated.toString("base64"), ciphertext].join(":"))).toThrow(SecretBoxError);
    expect(() => open([version, iv, "", ciphertext].join(":"))).toThrow(SecretBoxError);
  });

  it("throws SecretBoxError when the auth tag is longer than 16 bytes", () => {
    const sealed = seal("do-not-touch");
    const [version, iv, tag, ciphertext] = legacySeal("do-not-touch", TEST_KEY).split(":");
    const longer = Buffer.concat([Buffer.from(tag, "base64"), Buffer.from([0])]);
    expect(() => open([version, iv, longer.toString("base64"), ciphertext].join(":"))).toThrow(SecretBoxError);
  });

  it("produces a 16-byte tag that opens", () => {
    const tag = seal("tag-length").split(":")[3];
    expect(Buffer.from(tag, "base64")).toHaveLength(16);
  });

  it("throws SecretBoxError when a different key is used", () => {
    // env.ts parses process.env once at import time into a static `env`
    // object, so seal()/open() always use the suite's fixed SECRETS_KEY —
    // mutating process.env afterward wouldn't reach them. Instead, build a
    // "sealed with a different key" value directly with node:crypto using
    // the exact same wire format, and confirm open() (bound to the real
    // key) rejects it.
    const otherKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", otherKey, iv);
    const ciphertext = Buffer.concat([cipher.update("irrelevant", "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const sealedWithOtherKey = [
      "v1",
      iv.toString("base64"),
      tag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(":");

    expect(() => open(sealedWithOtherKey)).toThrow(SecretBoxError);
  });

  it("throws SecretBoxError on a malformed prefix", () => {
    expect(() => open("v2:aaaa:bbbb:cccc")).toThrow(SecretBoxError);
  });

  it("throws SecretBoxError on the wrong number of segments", () => {
    expect(() => open("v1:onlyoneseg")).toThrow(SecretBoxError);
  });

  it("throws SecretBoxError on garbage input", () => {
    expect(() => open("not-a-sealed-value")).toThrow(SecretBoxError);
  });

  it("throws SecretBoxError on an IV of the wrong length", () => {
    const shortIv = Buffer.alloc(4).toString("base64");
    const sealed = seal("whatever");
    const [version, , tag, ciphertext] = legacySeal("whatever", TEST_KEY).split(":");
    expect(() => open([version, shortIv, tag, ciphertext].join(":"))).toThrow(SecretBoxError);
  });

  it("still opens a value stored in the old v1 format", () => {
    expect(open(legacySeal("stored-before-v2", TEST_KEY))).toBe("stored-before-v2");
  });

  describe("key rotation", () => {
    const oldKey = crypto.randomBytes(32).toString("base64");
    const newKey = crypto.randomBytes(32).toString("base64");

    it("round-trips under a box with a previous key set, sealing with the current key", () => {
      const box = createSecretBox(newKey, oldKey);
      const sealed = box.seal("fresh");
      expect(box.open(sealed)).toBe("fresh");
      expect(createSecretBox(newKey).open(sealed)).toBe("fresh");
      expect(() => createSecretBox(oldKey).open(sealed)).toThrow(SecretBoxError);
    });

    it("opens v2 and v1 values sealed under the old key when it is set as previous", () => {
      const sealedV2 = createSecretBox(oldKey).seal("old-v2");
      const sealedV1 = legacySeal("old-v1", oldKey);
      const rotated = createSecretBox(newKey, oldKey);
      expect(rotated.open(sealedV2)).toBe("old-v2");
      expect(rotated.open(sealedV1)).toBe("old-v1");
    });

    it("fails with SecretBoxError when the previous key is absent", () => {
      const sealedV2 = createSecretBox(oldKey).seal("old-v2");
      const sealedV1 = legacySeal("old-v1", oldKey);
      const rotated = createSecretBox(newKey);
      expect(() => rotated.open(sealedV2)).toThrow(SecretBoxError);
      expect(() => rotated.open(sealedV1)).toThrow(SecretBoxError);
    });

    it("fails with SecretBoxError when the key id is tampered with", () => {
      const box = createSecretBox(newKey, oldKey);
      const parts = box.seal("bound").split(":");
      const unknownId = ["v2", "deadbeef", ...parts.slice(2)].join(":");
      expect(() => box.open(unknownId)).toThrow(SecretBoxError);
      // Pointing at the other configured key must fail too: the id is bound as additional data.
      const otherId = createSecretBox(oldKey).seal("x").split(":")[1];
      const swapped = ["v2", otherId, ...parts.slice(2)].join(":");
      expect(() => box.open(swapped)).toThrow(SecretBoxError);
    });
  });
});
