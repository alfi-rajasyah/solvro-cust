// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AuthUser } from "@/lib/auth";
import { Help } from "./Help";

// Help only reads useAuth(); hasPermission stays the real implementation so
// the topic gating under test is the app's own.
const auth = {
  status: "authenticated" as const,
  user: null as AuthUser | null,
  userVerified: false,
};
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, useAuth: () => auth };
});

function userWith(permissions: string[]): AuthUser {
  return { id: 1, email: "a@solvro.pl", name: "A", role: "TAM", permissions } as unknown as AuthUser;
}

const scrolled: string[] = [];

beforeEach(() => {
  scrolled.length = 0;
  // jsdom has no layout; record which element each scroll targets.
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
});

afterEach(() => {
  cleanup();
  auth.user = null;
  auth.userVerified = false;
});

function renderHelp() {
  return render(
    <MemoryRouter initialEntries={["/help#itop"]}>
      <Help />
    </MemoryRouter>,
  );
}

describe("Help deep link", () => {
  it("scrolls to the linked topic on mount", () => {
    auth.user = userWith(["project:read"]);
    auth.userVerified = true;
    renderHelp();
    expect(scrolled).toEqual(["itop"]);
  });

  it("scrolls again after the web fonts load, since the font swap reflows the page", async () => {
    let fontsLoaded!: () => void;
    const ready = new Promise<void>((resolve) => {
      fontsLoaded = resolve;
    });
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
    try {
      auth.user = userWith(["project:read"]);
      auth.userVerified = true;
      renderHelp();
      expect(scrolled).toEqual(["itop"]);

      fontsLoaded();
      await ready;
      await Promise.resolve();
      expect(scrolled).toEqual(["itop", "itop"]);
    } finally {
      delete (document as { fonts?: unknown }).fonts;
    }
  });

  it("scrolls again once the server confirms the user, after gated topics above it appear", () => {
    // Fresh page load: only the cached copy, without permissions yet.
    auth.user = userWith([]);
    auth.userVerified = false;
    const view = renderHelp();
    const before = scrolled.length;

    // /auth/me answers: gated topics render above the target, which moves it.
    auth.user = userWith(["project:read"]);
    auth.userVerified = true;
    view.rerender(
      <MemoryRouter initialEntries={["/help#itop"]}>
        <Help />
      </MemoryRouter>,
    );
    expect(scrolled.length).toBe(before + 1);
    expect(scrolled.at(-1)).toBe("itop");
  });
});
