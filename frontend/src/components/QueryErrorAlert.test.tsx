// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryErrorAlert } from "./QueryErrorAlert";

afterEach(cleanup);

describe("QueryErrorAlert", () => {
  it("shows the title and error message", () => {
    render(<QueryErrorAlert title="Could not load projects" error={new Error("boom")} onRetry={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("Could not load projects: boom");
  });

  it("calls refetch when Retry is clicked", () => {
    const refetch = vi.fn();
    render(<QueryErrorAlert title="Could not load projects" onRetry={refetch} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders no Retry button without onRetry, and shows children", () => {
    render(
      <QueryErrorAlert title="Project not found">
        <a href="/projects">Back to Projects</a>
      </QueryErrorAlert>,
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Projects" })).toBeTruthy();
  });
});
