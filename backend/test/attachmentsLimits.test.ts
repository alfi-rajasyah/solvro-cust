import { describe, expect, it } from "vitest";
import { parseAttachmentConfig } from "../src/lib/attachments/config.js";
import {
  cleanFileName,
  extensionOf,
  isAllowedExtension,
  mimeTypeFor,
  storageKeyFor,
} from "../src/lib/attachments/limits.js";

describe("cleanFileName", () => {
  it("strips path parts and control characters and collapses whitespace", () => {
    expect(cleanFileName("C:\\Users\\a\\report.pdf")).toBe("report.pdf");
    expect(cleanFileName("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(cleanFileName("a\u0000b\u0007c\n  d.txt")).toBe("a b c d.txt");
  });
  it("strips bidi and format characters", () => {
    expect(cleanFileName("a\u202Etxt.exe\u200F\u2066b\u2069.pdf")).toBe("a txt.exe b .pdf".replace(/ +/g, " "));
  });
  it("strips zero-width, BOM and Arabic letter mark characters", () => {
    expect(cleanFileName("re​port‌‍﻿؜.pdf")).toBe("re port .pdf");
  });
  it("falls back when nothing usable is left", () => {
    expect(cleanFileName("")).toBe("file");
    expect(cleanFileName("   ")).toBe("file");
    expect(cleanFileName("..")).toBe("file");
    expect(cleanFileName("a/")).toBe("file");
  });
  it("caps the length and keeps the extension", () => {
    const out = cleanFileName(`${"x".repeat(500)}.pdf`);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});

describe("extension allowlist and MIME map", () => {
  const allowed = parseAttachmentConfig({}).data!.ATTACHMENT_ALLOWED_EXTENSIONS;

  it("accepts the default types, case-insensitively", () => {
    expect(isAllowedExtension("Photo.JPG", allowed)).toBe(true);
    expect(isAllowedExtension("notes.md", allowed)).toBe(true);
  });
  it("rejects executables, html, svg and names without an extension", () => {
    for (const name of ["a.exe", "a.sh", "a.html", "a.htm", "a.svg", "README", ".env", "a."]) {
      expect(isAllowedExtension(name, allowed)).toBe(false);
    }
  });
  it("only the last extension counts", () => {
    expect(isAllowedExtension("a.pdf.exe", allowed)).toBe(false);
    expect(extensionOf("a.tar.ZIP")).toBe("zip");
  });
  it("maps every default extension to a specific type", () => {
    for (const ext of allowed) expect(mimeTypeFor(`f.${ext}`)).not.toBe("application/octet-stream");
    expect(mimeTypeFor("f.pdf")).toBe("application/pdf");
    expect(mimeTypeFor("f.unknown")).toBe("application/octet-stream");
  });
});

describe("storageKeyFor", () => {
  it("is tasks/<id>/<uuid> and unique", () => {
    const a = storageKeyFor(12);
    expect(a).toMatch(/^tasks\/12\/[0-9a-f-]{36}$/);
    expect(storageKeyFor(12)).not.toBe(a);
  });
});

describe("attachment config", () => {
  it("applies the plan defaults", () => {
    const parsed = parseAttachmentConfig({});
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      ATTACHMENTS_DRIVER: "local",
      ATTACHMENTS_DIR: "/app/uploads",
      ATTACHMENT_MAX_FILE_MB: 25,
      ATTACHMENT_MAX_FILES_PER_TASK: 20,
      ATTACHMENT_MAX_TASK_MB: 100,
      S3_FORCE_PATH_STYLE: false,
    });
    expect(parsed.data!.ATTACHMENT_ALLOWED_EXTENSIONS).toHaveLength(17);
  });
  it("parses a custom allowlist, dropping dots, case and blanks", () => {
    const parsed = parseAttachmentConfig({ ATTACHMENT_ALLOWED_EXTENSIONS: " .PDF, png ,,PDF" });
    expect(parsed.data!.ATTACHMENT_ALLOWED_EXTENSIONS).toEqual(["pdf", "png"]);
  });
  it("refuses the s3 driver with any S3_* value missing, naming it", () => {
    const full = {
      ATTACHMENTS_DRIVER: "s3",
      S3_ENDPOINT: "http://x",
      S3_REGION: "r",
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
    };
    expect(parseAttachmentConfig(full).success).toBe(true);
    const required = Object.keys(full).filter((k) => k.startsWith("S3_") && k !== "S3_ENDPOINT");
    for (const key of required) {
      const partial: Record<string, string> = { ...full, [key]: "" };
      const parsed = parseAttachmentConfig(partial);
      expect(parsed.success).toBe(false);
      expect(JSON.stringify(parsed.error!.issues)).toContain(`${key} is required`);
    }
  });
  it("does not require S3_ENDPOINT", () => {
    const parsed = parseAttachmentConfig({
      ATTACHMENTS_DRIVER: "s3",
      S3_REGION: "eu-west-1",
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
    });
    expect(parsed.success).toBe(true);
  });
  it("treats blank values as unset", () => {
    const parsed = parseAttachmentConfig({
      S3_FORCE_PATH_STYLE: "",
      ATTACHMENTS_DRIVER: " ",
      ATTACHMENTS_DIR: "",
      ATTACHMENT_MAX_FILE_MB: "",
      ATTACHMENT_MAX_FILES_PER_TASK: "  ",
      ATTACHMENT_MAX_TASK_MB: "",
      ATTACHMENT_ALLOWED_EXTENSIONS: "",
      S3_KEY_PREFIX: "",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      S3_FORCE_PATH_STYLE: false,
      ATTACHMENTS_DRIVER: "local",
      ATTACHMENT_MAX_FILE_MB: 25,
      S3_KEY_PREFIX: undefined,
    });
    expect(parseAttachmentConfig({ S3_FORCE_PATH_STYLE: "" }).data!.S3_FORCE_PATH_STYLE).toBe(false);
  });
  it("normalises S3_KEY_PREFIX to one trailing slash and no leading slash", () => {
    for (const raw of ["solvro", "/solvro/", "//solvro//"]) {
      expect(parseAttachmentConfig({ S3_KEY_PREFIX: raw }).data!.S3_KEY_PREFIX).toBe("solvro/");
    }
  });
  it("refuses an allowlist with no extension in it", () => {
    const parsed = parseAttachmentConfig({ ATTACHMENT_ALLOWED_EXTENSIONS: " , ,." });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error!.issues)).toContain("at least one extension");
  });
  it("parses S3_FORCE_PATH_STYLE as a boolean and rejects junk", () => {
    expect(parseAttachmentConfig({ S3_FORCE_PATH_STYLE: "true" }).data!.S3_FORCE_PATH_STYLE).toBe(true);
    expect(parseAttachmentConfig({ S3_FORCE_PATH_STYLE: "0" }).data!.S3_FORCE_PATH_STYLE).toBe(false);
    expect(parseAttachmentConfig({ S3_FORCE_PATH_STYLE: "maybe" }).success).toBe(false);
    expect(parseAttachmentConfig({ ATTACHMENTS_DRIVER: "ftp" }).success).toBe(false);
  });
});
