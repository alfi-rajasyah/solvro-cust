import { describe, expect, it } from "vitest";
import { normalizeSnippet, snippetText } from "./outlineSnippet";

describe("normalizeSnippet", () => {
  it("keeps well-formed segments and their highlight flag", () => {
    expect(
      normalizeSnippet([
        { text: "the ", highlight: false },
        { text: "launch", highlight: true },
        { text: " plan", highlight: false },
      ]),
    ).toEqual([
      { text: "the ", highlight: false },
      { text: "launch", highlight: true },
      { text: " plan", highlight: false },
    ]);
  });

  it("folds line breaks and whitespace runs, and trims the outer edges", () => {
    const out = normalizeSnippet([
      { text: "\n  first line\n\n", highlight: false },
      { text: "second", highlight: true },
      { text: "   tail \n", highlight: false },
    ]);
    expect(snippetText(out)).toBe("first line second tail");
    expect(out[1]).toEqual({ text: "second", highlight: true });
  });

  it("merges neighbours of the same kind and drops empty segments", () => {
    expect(
      normalizeSnippet([
        { text: "a", highlight: false },
        { text: "", highlight: true },
        { text: "b", highlight: false },
      ]),
    ).toEqual([{ text: "ab", highlight: false }]);
  });

  it("treats markup as plain text - it is never interpreted", () => {
    const out = normalizeSnippet([{ text: '<img src=x onerror="alert(1)"><b>x</b>', highlight: true }]);
    expect(out).toEqual([{ text: '<img src=x onerror="alert(1)"><b>x</b>', highlight: true }]);
  });

  it("ignores malformed input", () => {
    expect(normalizeSnippet(undefined)).toEqual([]);
    expect(normalizeSnippet("<b>x</b>")).toEqual([]);
    expect(normalizeSnippet([null, 3, { text: 5 }, { highlight: true }, { text: "ok" }])).toEqual([
      { text: "ok", highlight: false },
    ]);
  });
});
