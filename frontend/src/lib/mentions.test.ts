import { describe, expect, it } from "vitest";
import {
  activeMentionQuery,
  deriveMentionedIds,
  filterMentionCandidates,
  findMentions,
  insertMention,
  MAX_MENTIONS,
  splitComment,
} from "./mentions";

const ana = { id: 1, username: "ana" };
const anaB = { id: 2, username: "ana.b" };
const ben = { id: 3, username: "ben-lee" };
const cara = { id: 4, username: "cara_k" };
const users = [ana, anaB, ben, cara];

describe("activeMentionQuery", () => {
  it("finds the @query before the caret", () => {
    expect(activeMentionQuery("hi @an", 6)).toEqual({ start: 3, query: "an" });
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMentionQuery("hi @ana.b", 9)).toEqual({ start: 3, query: "ana.b" });
  });

  it("needs the @ to start a word and no whitespace after it", () => {
    expect(activeMentionQuery("mail me at a@b", 14)).toBeNull();
    expect(activeMentionQuery("hi @ana done", 12)).toBeNull();
    expect(activeMentionQuery("no at sign", 5)).toBeNull();
  });

  it("uses only the text before the caret", () => {
    expect(activeMentionQuery("hi @ana rest", 5)).toEqual({ start: 3, query: "a" });
  });
});

describe("filterMentionCandidates", () => {
  it("prefix matches first, then contains, case-insensitive", () => {
    expect(filterMentionCandidates(users, "AN").map((u) => u.id)).toEqual([1, 2]);
    expect(filterMentionCandidates(users, "lee").map((u) => u.id)).toEqual([3]);
    expect(filterMentionCandidates(users, "").length).toBe(4);
    expect(filterMentionCandidates(users, "zzz")).toEqual([]);
  });

  it("honours the limit", () => {
    expect(filterMentionCandidates(users, "", 2)).toHaveLength(2);
  });
});

describe("insertMention", () => {
  it("replaces the typed query with the name and a space", () => {
    const q = activeMentionQuery("hi @an there", 6)!;
    expect(insertMention("hi @an there", q, 6, "ana")).toEqual({ text: "hi @ana  there", caret: 8 });
  });

  it("works at the end of the text", () => {
    const q = activeMentionQuery("@b", 2)!;
    expect(insertMention("@b", q, 2, "ben-lee")).toEqual({ text: "@ben-lee ", caret: 9 });
  });
});

describe("findMentions", () => {
  it("prefers the longest name", () => {
    expect(findMentions("hi @ana.b!", users).map((m) => m.user.id)).toEqual([2]);
    expect(findMentions("hi @ana and @ana.b", users).map((m) => m.user.id)).toEqual([1, 2]);
  });

  it("handles dots, dashes, underscores and trailing punctuation", () => {
    expect(findMentions("@ben-lee, thanks", users).map((m) => m.user.id)).toEqual([3]);
    expect(findMentions("ok @cara_k.", users).map((m) => m.user.id)).toEqual([4]);
    expect(findMentions("(@ana)", users).map((m) => m.user.id)).toEqual([1]);
    expect(findMentions("ping @ana?", users).map((m) => m.user.id)).toEqual([1]);
  });

  it("does not match inside a longer word, an email or another name", () => {
    expect(findMentions("@anaconda", users)).toEqual([]);
    expect(findMentions("mail x@ana", users)).toEqual([]);
    expect(findMentions("@ana.smith", [ana])).toEqual([]);
  });

  it("supports names with spaces", () => {
    const spaced = { id: 9, username: "Maya Putri" };
    expect(findMentions("hey @Maya Putri, look", [spaced])).toHaveLength(1);
  });

  it("is case-sensitive", () => {
    expect(findMentions("@Ana", users)).toEqual([]);
  });
});

describe("deriveMentionedIds", () => {
  it("keeps recorded picks that are still in the body", () => {
    expect(deriveMentionedIds("hi @ana and @ben-lee", [ana, ben])).toEqual([1, 3]);
  });

  it("drops a pick whose text was removed", () => {
    expect(deriveMentionedIds("hi @ana", [ana, ben])).toEqual([1]);
    expect(deriveMentionedIds("hi an", [ana])).toEqual([]);
    expect(deriveMentionedIds("hi @an", [ana])).toEqual([]);
  });

  it("does not add ids for names typed by hand", () => {
    expect(deriveMentionedIds("hi @ana", [])).toEqual([]);
  });

  it("dedupes and caps", () => {
    expect(deriveMentionedIds("@ana @ana", [ana])).toEqual([1]);
    const many = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, username: `u${i + 1}x` }));
    const body = many.map((u) => `@${u.username}`).join(" ");
    expect(deriveMentionedIds(body, many)).toHaveLength(MAX_MENTIONS);
  });

  it("a shorter recorded name is not fooled by a longer typed one", () => {
    expect(deriveMentionedIds("hi @ana.smith", [ana])).toEqual([]);
  });
});

describe("splitComment", () => {
  it("turns only mentioned users' tokens into mention pieces", () => {
    expect(splitComment("hi @ana, cc @ben-lee and @nobody", [1], users)).toEqual([
      { kind: "text", text: "hi " },
      { kind: "mention", text: "@ana", userId: 1 },
      { kind: "text", text: ", cc @ben-lee and @nobody" },
    ]);
  });

  it("returns the body untouched with no ids or no known users", () => {
    expect(splitComment("hi @ana", [], users)).toEqual([{ kind: "text", text: "hi @ana" }]);
    expect(splitComment("hi @ana", undefined, users)).toEqual([{ kind: "text", text: "hi @ana" }]);
    expect(splitComment("hi @ana", [1], [])).toEqual([{ kind: "text", text: "hi @ana" }]);
  });

  it("keeps HTML-looking text as plain text", () => {
    const pieces = splitComment("<b>@ana</b>", [1], users);
    expect(pieces.map((p) => p.text).join("")).toBe("<b>@ana</b>");
  });

  it("handles a mention at the start and end", () => {
    expect(splitComment("@ana", [1], users)).toEqual([{ kind: "mention", text: "@ana", userId: 1 }]);
  });

  it("handles an empty body", () => {
    expect(splitComment("", [1], users)).toEqual([{ kind: "text", text: "" }]);
  });
});
