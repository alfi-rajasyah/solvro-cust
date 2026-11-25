// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InboundHook } from "@/lib/queries";
import { ProjectIntegrationsDialog } from "./ProjectIntegrationsDialog";

const fetchMock = vi.fn();
type Handler = (init: RequestInit) => Response | Promise<Response>;
let routes: Record<string, Handler> = {};

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

function hook(over: Partial<InboundHook> = {}): InboundHook {
  return {
    id: 1,
    name: "GitLab",
    tokenPreview: "AbCd",
    active: true,
    disabledReason: null,
    lastReceivedAt: null,
    createdAt: "2026-11-20T10:00:00.000Z",
    createdBy: { id: 4, name: "tam" },
    hasSigningSecret: false,
    ...over,
  };
}

const LIST = "GET /api/projects/7/inbound-hooks";
const URL_ = "https://solvro.example.com/api/webhook/in/TOKEN43";

beforeEach(() => {
  routes = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string, init: RequestInit = {}) => {
    const handler = routes[`${init.method ?? "GET"} ${path.split("?")[0]}`];
    return Promise.resolve(
      handler ? handler(init) : json(404, { error: "unrouted" }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderDialog() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <ProjectIntegrationsDialog projectId={7} open onClose={() => {}} />,
    { wrapper },
  );
}

describe("ProjectIntegrationsDialog", () => {
  it("lists a URL by name and token preview, never a full URL", async () => {
    routes[LIST] = () =>
      json(200, { hooks: [hook({ hasSigningSecret: true })] });
    renderDialog();
    const row = await screen.findByTestId("inbound-hook-1");
    expect(within(row).getByText("GitLab")).toBeTruthy();
    expect(within(row).getByText("AbCd…")).toBeTruthy();
    expect(within(row).getByText("Signature required")).toBeTruthy();
    expect(within(row).getByText("Never")).toBeTruthy();
    expect(screen.queryByTestId("inbound-url")).toBeNull();
  });

  it("shows the new URL once after Add and drops it when dismissed", async () => {
    let created = false;
    routes[LIST] = () => json(200, { hooks: created ? [hook()] : [] });
    routes["POST /api/projects/7/inbound-hooks"] = () => {
      created = true;
      return json(201, { hook: hook(), url: URL_ });
    };
    renderDialog();
    await screen.findByText(/No incoming URLs yet/);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "GitLab" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add URL" }));

    expect((await screen.findByTestId("inbound-url")).textContent).toBe(URL_);
    expect(
      screen.getByText(/Shown once\. If you lose it, rotate the URL\./),
    ).toBeTruthy();
    expect(await screen.findByTestId("inbound-hook-1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "I have saved it" }));
    expect(screen.queryByTestId("inbound-url")).toBeNull();
    expect(document.body.textContent).not.toContain("TOKEN43");
  });

  it("shows the token and asks for APP_URL when the server has no public address", async () => {
    routes[LIST] = () => json(200, { hooks: [] });
    routes["POST /api/projects/7/inbound-hooks"] = () =>
      json(201, { hook: hook(), url: null, token: "RAWTOKEN" });
    renderDialog();
    await screen.findByText(/No incoming URLs yet/);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "CI" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add URL" }));
    expect((await screen.findByTestId("inbound-token")).textContent).toBe(
      "RAWTOKEN",
    );
    expect(screen.getByText(/set APP_URL/)).toBeTruthy();
  });

  it("rotates only after a confirm dialog, shows the new URL once and focuses its copy button", async () => {
    routes[LIST] = () => json(200, { hooks: [hook()] });
    routes["POST /api/projects/7/inbound-hooks/1/rotate-token"] = () =>
      json(200, { hook: hook(), url: URL_ });
    renderDialog();
    await screen.findByTestId("inbound-hook-1");
    fireEvent.click(
      within(screen.getByTestId("inbound-hook-1")).getByRole("button", {
        name: "Rotate URL",
      }),
    );
    const confirm = await screen.findByRole("dialog", { name: "Rotate URL?" });
    expect(
      fetchMock.mock.calls.some(([p]) => String(p).includes("rotate-token")),
    ).toBe(false);
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Rotate URL" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("inbound-url").textContent).toBe(URL_),
    );
    expect(screen.getByText(/old URL no longer works/)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Rotate URL?" })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Copy URL" }),
      ),
    );
    expect(
      screen.getByText(/Shown once\. If you lose it, rotate the URL\./),
    ).toBeTruthy();

    // Dismissing returns focus to the row's Rotate URL button.
    fireEvent.click(screen.getByRole("button", { name: "I have saved it" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(screen.getByTestId("inbound-hook-1")).getByRole("button", {
          name: "Rotate URL",
        }),
      ),
    );
  });

  it("asks before requiring a signature, then shows the secret once", async () => {
    routes[LIST] = () => json(200, { hooks: [hook()] });
    routes["POST /api/projects/7/inbound-hooks/1/signing-secret"] = () =>
      json(200, {
        hook: hook({ hasSigningSecret: true }),
        secret: "whsec_abc",
      });
    renderDialog();
    await screen.findByTestId("inbound-hook-1");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Require a Standard Webhooks signature",
      }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: "Require a signature?",
    });
    expect(
      within(confirm).getByText(
        /without a valid Standard Webhooks signature fail from now on/,
      ),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([p]) => String(p).includes("signing-secret")),
    ).toBe(false);
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Require signature" }),
    );
    expect((await screen.findByTestId("inbound-secret")).textContent).toBe(
      "whsec_abc",
    );
    fireEvent.click(screen.getByRole("button", { name: "I have saved it" }));
    expect(screen.queryByTestId("inbound-secret")).toBeNull();
  });

  it("warns that a new signing secret ends the old one at once", async () => {
    routes[LIST] = () =>
      json(200, { hooks: [hook({ hasSigningSecret: true })] });
    renderDialog();
    await screen.findByTestId("inbound-hook-1");
    fireEvent.click(screen.getByRole("button", { name: "New signing secret" }));
    const confirm = await screen.findByRole("dialog", {
      name: "Make a new signing secret?",
    });
    expect(
      within(confirm).getByText(
        /current secret of GitLab stops working at once/,
      ),
    ).toBeTruthy();
  });

  it("deletes behind a confirm and moves focus to the Name field when the row is gone", async () => {
    let deleted = false;
    routes[LIST] = () => json(200, { hooks: deleted ? [] : [hook()] });
    routes["DELETE /api/projects/7/inbound-hooks/1"] = () => {
      deleted = true;
      return json(204);
    };
    renderDialog();
    await screen.findByTestId("inbound-hook-1");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete URL?" });
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Delete URL" }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("inbound-hook-1")).toBeNull(),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Name")),
    );
  });

  it("explains why a URL was turned off and who comments are written as", async () => {
    routes[LIST] = () =>
      json(200, {
        hooks: [
          hook({ active: false, disabledReason: "creator_lost_access" }),
          hook({
            id: 2,
            name: "CI",
            active: false,
            disabledReason: "something_new",
          }),
        ],
      });
    renderDialog();
    await screen.findByTestId("inbound-hook-1");
    expect(
      screen.getByText(
        "The user who created this URL can no longer open this project.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Turned off.")).toBeTruthy();
    expect(screen.getAllByText("Comments are written as tam.")).toHaveLength(2);
    expect(document.body.textContent).not.toContain("creator_lost_access");
  });

  it("explains the limit with the server's message", async () => {
    routes[LIST] = () => json(200, { hooks: [] });
    routes["POST /api/projects/7/inbound-hooks"] = () =>
      json(409, {
        error:
          "A project can have at most 5 incoming URLs. Delete one to add another.",
        code: "inbound_hook_limit",
      });
    renderDialog();
    await screen.findByText(/No incoming URLs yet/);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Sixth" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add URL" }));
    expect(await screen.findByText(/at most 5 incoming URLs/)).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Name")),
    );
  });

  it("keeps focus on Disable after the request settles", async () => {
    routes[LIST] = () => json(200, { hooks: [hook()] });
    routes["PATCH /api/projects/7/inbound-hooks/1"] = () =>
      json(200, { hook: hook({ active: false }) });
    renderDialog();
    await screen.findByTestId("inbound-hook-1");
    const button = screen.getByRole("button", { name: "Disable" });
    button.focus();
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Disable" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Disable" }),
      ),
    );
  });
});
