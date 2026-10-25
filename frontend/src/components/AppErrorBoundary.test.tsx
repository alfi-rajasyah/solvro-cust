// @vitest-environment jsdom
import { lazy, Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { PageLoading } from "./skeletons";

// A child that throws while `state.broken` is true. The flag lives outside the
// component so a test can "repair" it before pressing Try again.
const state = { broken: true };
function Fragile() {
  if (state.broken) throw new Error("bad server value");
  return <p>page content</p>;
}

// In development React re-throws a caught render error once through a window
// "error" event, which jsdom then prints. Cancelling the event keeps the test
// output readable; the boundary still catches the error.
const swallow = (e: Event) => e.preventDefault();

beforeEach(() => {
  state.broken = true;
  window.addEventListener("error", swallow);
  // React also logs every caught render error.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  window.removeEventListener("error", swallow);
  vi.restoreAllMocks();
});

describe("AppErrorBoundary", () => {
  it("a lazily loaded page whose chunk fails to load shows the page fallback", async () => {
    // What a stale tab sees after a deploy removed the chunk it asks for and
    // the one-time reload (lib/chunkReload.ts) did not help: React.lazy keeps
    // the rejection, so only the fallback's Reload recovers.
    const Missing = lazy(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
    render(
      <AppErrorBoundary variant="page">
        <Suspense fallback={<PageLoading />}>
          <Missing />
        </Suspense>
      </AppErrorBoundary>,
    );
    expect(screen.getByTestId("page-loading").textContent).toContain("Loading");
    expect((await screen.findByTestId("page-error")).textContent).toContain("This page could not be shown");
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  it("renders its children when nothing throws", () => {
    state.broken = false;
    render(
      <AppErrorBoundary variant="page">
        <Fragile />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("page content")).toBeTruthy();
    expect(screen.queryByTestId("page-error")).toBeNull();
  });

  it("page variant: shows the fallback in place of the page and leaves siblings alone", () => {
    render(
      <div>
        <nav>sidebar link</nav>
        <AppErrorBoundary variant="page">
          <Fragile />
        </AppErrorBoundary>
      </div>,
    );
    const fallback = screen.getByTestId("page-error");
    expect(fallback.textContent).toContain("This page could not be shown");
    expect(screen.getByRole("alert")).toBeTruthy();
    // The rest of the layout (the shell's sidebar and top bar) still renders.
    expect(screen.getByText("sidebar link")).toBeTruthy();
    expect(screen.queryByText("page content")).toBeNull();
  });

  it("Try again re-renders the children once the cause is gone", () => {
    render(
      <AppErrorBoundary variant="page">
        <Fragile />
      </AppErrorBoundary>,
    );
    expect(screen.getByTestId("page-error")).toBeTruthy();
    state.broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("page content")).toBeTruthy();
    expect(screen.queryByTestId("page-error")).toBeNull();
  });

  it("Try again while the cause remains shows the fallback again, not a blank page", () => {
    render(
      <AppErrorBoundary variant="page">
        <Fragile />
      </AppErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByTestId("page-error")).toBeTruthy();
  });

  it("a new resetKey (navigation) runs onReset and clears the error", () => {
    const onReset = vi.fn();
    const { rerender } = render(
      <AppErrorBoundary variant="page" resetKey="/projects/1/gantt" onReset={onReset}>
        <Fragile />
      </AppErrorBoundary>,
    );
    expect(screen.getByTestId("page-error")).toBeTruthy();
    expect(onReset).not.toHaveBeenCalled();
    state.broken = false;
    rerender(
      <AppErrorBoundary variant="page" resetKey="/overview" onReset={onReset}>
        <Fragile />
      </AppErrorBoundary>,
    );
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText("page content")).toBeTruthy();
  });

  it("a resetKey change without an error does not run onReset", () => {
    state.broken = false;
    const onReset = vi.fn();
    const { rerender } = render(
      <AppErrorBoundary variant="page" resetKey="/a" onReset={onReset}>
        <Fragile />
      </AppErrorBoundary>,
    );
    rerender(
      <AppErrorBoundary variant="page" resetKey="/b" onReset={onReset}>
        <Fragile />
      </AppErrorBoundary>,
    );
    expect(onReset).not.toHaveBeenCalled();
  });

  it("the same resetKey keeps the fallback (a re-render alone does not hide the error)", () => {
    const { rerender } = render(
      <AppErrorBoundary variant="page" resetKey="/overview">
        <Fragile />
      </AppErrorBoundary>,
    );
    state.broken = false;
    rerender(
      <AppErrorBoundary variant="page" resetKey="/overview">
        <Fragile />
      </AppErrorBoundary>,
    );
    expect(screen.getByTestId("page-error")).toBeTruthy();
  });

  it("Try again runs onReset before re-rendering", () => {
    const order: string[] = [];
    function Probe() {
      order.push(state.broken ? "render-broken" : "render-ok");
      if (state.broken) throw new Error("bad server value");
      return <p>page content</p>;
    }
    const onReset = vi.fn(() => {
      order.push("reset");
      state.broken = false; // the reset is what removes the cause (fresh data)
    });
    render(
      <AppErrorBoundary variant="page" onReset={onReset}>
        <Probe />
      </AppErrorBoundary>,
    );
    order.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe("reset");
    expect(screen.getByText("page content")).toBeTruthy();
  });

  it("Reload calls the reload function", () => {
    const reload = vi.fn();
    render(
      <AppErrorBoundary variant="page" reload={reload}>
        <Fragile />
      </AppErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("app variant: a full-screen fallback with a heading and Reload only", () => {
    const reload = vi.fn();
    render(
      <AppErrorBoundary variant="app" reload={reload}>
        <Fragile />
      </AppErrorBoundary>,
    );
    expect(screen.getByTestId("app-error")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Solvro could not show this screen");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("catches a thrown non-Error value too", () => {
    function ThrowsString(): never {
      throw "plain string";
    }
    render(
      <AppErrorBoundary variant="page">
        <ThrowsString />
      </AppErrorBoundary>,
    );
    expect(screen.getByTestId("page-error")).toBeTruthy();
  });
});
