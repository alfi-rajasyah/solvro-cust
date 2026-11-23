// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TopBar } from "./TopBar";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: 1, email: "a@solvro.pl", username: "alfi", role: "TAM", permissions: [] },
    logout: vi.fn(),
  }),
}));
vi.mock("@/lib/theme", () => ({ useTheme: () => ({ resolved: "light", toggle: vi.fn() }) }));
vi.mock("@/lib/queries", () => ({
  useProject: () => ({ data: undefined }),
  useCustomer: () => ({ data: undefined }),
  useTask: () => ({ data: undefined }),
  useProjectTasks: () => ({ data: undefined }),
}));
vi.mock("./SidebarContext", () => ({ useSidebar: () => ({ open: true, toggle: vi.fn() }) }));
vi.mock("./NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/itop/useTicketTimer", () => ({
  useRunningItopTimer: () => null,
  formatElapsed: () => "",
}));
vi.mock("@/components/StatusChip", () => ({ ProjectStatusChip: () => null }));

// jsdom has no layout, so every element reports no client rects. Treat an
// element as hidden only when it sits inside an `md:hidden` ancestor, which
// is how the real menu hides Help and the theme toggle on desktop.
const originalRects = HTMLElement.prototype.getClientRects;
beforeEach(() => {
  HTMLElement.prototype.getClientRects = function (this: HTMLElement) {
    const hidden = this.closest(".md\\:hidden") !== null && hideMdOnly;
    return (hidden ? [] : [{}]) as unknown as DOMRectList;
  };
});
afterEach(() => {
  cleanup();
  HTMLElement.prototype.getClientRects = originalRects;
  hideMdOnly = false;
});
let hideMdOnly = false;

function setup() {
  render(
    <MemoryRouter>
      <TopBar onOpenSearch={vi.fn()} />
    </MemoryRouter>,
  );
  return screen.getByRole("button", { name: "Account menu" });
}

function labels() {
  return screen.getAllByRole("menuitem").map((el) => el.textContent?.replace(/\s+/g, " ").trim());
}

describe("account menu keyboard", () => {
  it("ArrowDown on the closed trigger opens the menu and focuses the first item", () => {
    const trigger = setup();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getAllByRole("menuitem")[0]);
  });

  it("moves with Down and Up, wrapping at both ends", () => {
    const trigger = setup();
    fireEvent.click(trigger);
    const items = screen.getAllByRole("menuitem");
    const last = items.length - 1;
    items[last].focus();
    fireEvent.keyDown(items[last], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[last]);
    fireEvent.keyDown(items[last], { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "End" });
    expect(document.activeElement).toBe(items[last]);
  });

  it("ArrowDown from the open trigger focuses the first item, ArrowUp the last", () => {
    const trigger = setup();
    fireEvent.click(trigger);
    const items = screen.getAllByRole("menuitem");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it("skips the md:hidden items when they are not rendered visible", () => {
    hideMdOnly = true;
    const trigger = setup();
    fireEvent.click(trigger);
    expect(labels().some((l) => l?.includes("Help"))).toBe(true);
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Settings");
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement?.textContent).toContain("Sign out");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Settings");
  });

  it("Tab closes the menu and returns focus to the trigger", () => {
    const trigger = setup();
    fireEvent.click(trigger);
    const items = screen.getAllByRole("menuitem");
    items[1].focus();
    fireEvent.keyDown(items[1], { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape still closes the menu and focuses the trigger", () => {
    const trigger = setup();
    fireEvent.click(trigger);
    screen.getAllByRole("menuitem")[0].focus();
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
