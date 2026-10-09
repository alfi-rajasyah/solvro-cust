import { describe, expect, it } from "vitest";
import {
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
