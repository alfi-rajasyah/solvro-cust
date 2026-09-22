// Pure-helper suite — no DB. Exercises backend/src/lib/secretBox.ts against
// the fixed 32-byte SECRETS_KEY provided by test/env.ts.
import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { open, seal, SecretBoxError } from "../src/lib/secretBox.js";

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

  it("uses the v1:<iv>:<tag>:<ciphertext> format", () => {
    const sealed = seal("hello");
    const parts = sealed.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("throws SecretBoxError when the ciphertext is tampered with", () => {
    const sealed = seal("do-not-touch");
    const [version, iv, tag, ciphertext] = sealed.split(":");
    const tamperedByte = Buffer.from(ciphertext, "base64");
    tamperedByte[0] = tamperedByte[0] ^ 0xff;
    const tampered = [version, iv, tag, tamperedByte.toString("base64")].join(":");
    expect(() => open(tampered)).toThrow(SecretBoxError);
  });

  it("throws SecretBoxError when the auth tag is tampered with", () => {
    const sealed = seal("do-not-touch");
    const [version, iv, tag, ciphertext] = sealed.split(":");
    const tamperedTag = Buffer.from(tag, "base64");
    tamperedTag[0] = tamperedTag[0] ^ 0xff;
    const tampered = [version, iv, tamperedTag.toString("base64"), ciphertext].join(":");
    expect(() => open(tampered)).toThrow(SecretBoxError);
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
    const [version, , tag, ciphertext] = sealed.split(":");
    expect(() => open([version, shortIv, tag, ciphertext].join(":"))).toThrow(SecretBoxError);
  });
});
