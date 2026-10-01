import { describe, expect, it } from "vitest";
import { DEFAULT_POST_LOGIN_PATH, safeRedirectPath } from "./safeRedirect";

describe("safeRedirectPath", () => {
  it("keeps an in-app path with its query and hash", () => {
    expect(safeRedirectPath("/projects/6?task=42")).toBe("/projects/6?task=42");
    expect(safeRedirectPath("/projects/6/list?epic=3&task=42#comments")).toBe(
      "/projects/6/list?epic=3&task=42#comments",
    );
    expect(safeRedirectPath("/")).toBe("/");
  });

  it("falls back to Overview when there is nothing usable", () => {
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeRedirectPath(null)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeRedirectPath(42)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeRedirectPath("")).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeRedirectPath("projects/6")).toBe(DEFAULT_POST_LOGIN_PATH);
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeRedirectPath("https://evil.example/x")).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeRedirectPath("//evil.example/x")).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeRedirectPath("/\\evil.example/x")).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeRedirectPath("javascript:alert(1)")).toBe(DEFAULT_POST_LOGIN_PATH);
  });

  it("rejects paths the URL parser would turn into another origin", () => {
    expect(safeRedirectPath("/\t/evil.example")).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeRedirectPath("/\n/evil.example")).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeRedirectPath("/\r/evil.example")).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeRedirectPath("/a\\b")).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeRedirectPath("/projects/6?next=\u0000")).toBe(DEFAULT_POST_LOGIN_PATH);
  });
});
