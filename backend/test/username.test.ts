// Unit tests for the username rule (lib/username.ts,
// docs/archive/plans/internal-sync.md). The HTTP behaviour (400/409 on
// POST /admin/users) is covered in pentestRemediation.test.ts.
import { describe, expect, it } from "vitest";
import { normalizeUsername, USERNAME_MAX } from "../src/lib/username.js";

describe("normalizeUsername", () => {
  it("accepts ordinary names and keeps accented Latin letters", () => {
    expect(normalizeUsername("Maya Putri")).toBe("Maya Putri");
    expect(normalizeUsername("rizky.pratama")).toBe("rizky.pratama");
    expect(normalizeUsername("José")).toBe("José");
    expect(normalizeUsername("o'neil-smith_2")).toBe("o'neil-smith_2");
  });

  it("folds full-width letters (NFKC), trims, and collapses inner whitespace", () => {
    expect(normalizeUsername("ａｂｃ")).toBe("abc");
    expect(normalizeUsername("  Maya   Putri  ")).toBe("Maya Putri");
  });

  it("rejects empty, over-long, and look-alike input", () => {
    expect(normalizeUsername("")).toBeNull();
    expect(normalizeUsername("   ")).toBeNull();
    expect(normalizeUsername("a".repeat(USERNAME_MAX + 1))).toBeNull();
    expect(normalizeUsername("a".repeat(USERNAME_MAX))).not.toBeNull();
    expect(normalizeUsername("аdmin")).toBeNull(); // Cyrillic a
    expect(normalizeUsername("ad​min")).toBeNull(); // zero-width space
    expect(normalizeUsername("admın")).toBeNull(); // dotless i
  });

  it("returns null for a Google local part that fails the rule (caller falls back)", () => {
    expect(normalizeUsername("аlice")).toBeNull();
    expect(normalizeUsername("alice+tag")).toBeNull();
  });
});
