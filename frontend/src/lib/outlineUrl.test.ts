import { describe, expect, it } from "vitest";
import {
  isOutlineAuthorizeUrl,
  OUTLINE_URL_MAX_LENGTH,
  parseOutlineBaseUrl,
  parseOutlineUrl,
  safeOutlineHref,
} from "./outlineUrl";

describe("parseOutlineUrl", () => {
  it("trims, and treats empty or whitespace as clearing the link", () => {
    expect(parseOutlineUrl("  https://docs.example.com/doc/a-1 ")).toEqual({
      ok: true,
      value: "https://docs.example.com/doc/a-1",
    });
    expect(parseOutlineUrl("")).toEqual({ ok: true, value: null });
    expect(parseOutlineUrl("   ")).toEqual({ ok: true, value: null });
  });

  it("accepts http and https only", () => {
    expect(parseOutlineUrl("http://wiki.local").ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x", "docs.example.com", "//a.b/c", "/x"]) {
      expect(parseOutlineUrl(bad).ok, bad).toBe(false);
    }
  });

  it("caps the length at 2048 characters", () => {
    const base = "https://a.b/";
    expect(parseOutlineUrl(base + "x".repeat(OUTLINE_URL_MAX_LENGTH - base.length)).ok).toBe(true);
    expect(parseOutlineUrl(base + "x".repeat(OUTLINE_URL_MAX_LENGTH + 1 - base.length)).ok).toBe(false);
  });
});

describe("control characters", () => {
  it("are refused anywhere in the value", () => {
    for (const bad of ["https://a.b/\u0000x", "https://a.b/\nx", "https://a.b/c\u007Fd", "https://a.b/\tx"]) {
      expect(parseOutlineUrl(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    // Surrounding whitespace is trimmed first, so a trailing newline is fine.
    expect(parseOutlineUrl("https://a.b/c\n")).toEqual({ ok: true, value: "https://a.b/c" });
  });
});

describe("parseOutlineBaseUrl", () => {
  it("accepts a plain address, with or without a path, and clears on empty", () => {
    expect(parseOutlineBaseUrl(" https://docs.example.com ")).toEqual({
      ok: true,
      value: "https://docs.example.com",
    });
    expect(parseOutlineBaseUrl("https://example.com/outline").ok).toBe(true);
    expect(parseOutlineBaseUrl("")).toEqual({ ok: true, value: null });
  });

  it("rejects a login, query string or fragment", () => {
    for (const bad of [
      "https://user:pw@docs.example.com",
      "https://user@docs.example.com",
      "https://docs.example.com/?x=1",
      "https://docs.example.com/#top",
    ]) {
      expect(parseOutlineBaseUrl(bad).ok, bad).toBe(false);
    }
  });

  it("still applies the shared rule", () => {
    expect(parseOutlineBaseUrl("javascript:alert(1)").ok).toBe(false);
    expect(parseOutlineBaseUrl("ftp://x").ok).toBe(false);
  });
});

describe("safeOutlineHref", () => {
  it("returns only http(s) links", () => {
    expect(safeOutlineHref("https://docs.example.com")).toBe("https://docs.example.com");
    expect(safeOutlineHref("javascript:alert(1)")).toBeNull();
    expect(safeOutlineHref(null)).toBeNull();
    expect(safeOutlineHref("")).toBeNull();
  });
});

describe("isOutlineAuthorizeUrl", () => {
  const base = "https://docs.acme.com";
  it("accepts a URL on the configured Outline origin", () => {
    expect(isOutlineAuthorizeUrl("https://docs.acme.com/oauth/authorize?client_id=x&state=y", base)).toBe(true);
    expect(isOutlineAuthorizeUrl("https://docs.acme.com:443/oauth/authorize", base)).toBe(true);
  });
  it("refuses another origin, port, scheme or lookalike host", () => {
    for (const bad of [
      "https://evil.example/oauth/authorize",
      "https://docs.acme.com.evil.example/oauth/authorize",
      "http://docs.acme.com/oauth/authorize",
      "https://docs.acme.com:8443/oauth/authorize",
      "javascript:alert(1)",
      "//docs.acme.com/oauth/authorize",
      "/oauth/authorize",
      "",
    ]) {
      expect(isOutlineAuthorizeUrl(bad, base), bad).toBe(false);
    }
  });
  it("refuses anything without a configured address or a string", () => {
    expect(isOutlineAuthorizeUrl("https://docs.acme.com/x", null)).toBe(false);
    expect(isOutlineAuthorizeUrl("https://docs.acme.com/x", undefined)).toBe(false);
    expect(isOutlineAuthorizeUrl(undefined, base)).toBe(false);
    expect(isOutlineAuthorizeUrl({ href: "https://docs.acme.com" }, base)).toBe(false);
  });
});
