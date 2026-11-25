// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Webhook } from "@/lib/queries";
import { WebhooksPanel } from "./WebhooksPanel";
import { deliveryErrorLabel } from "@/lib/labels";
import { eventsSummary, lastDeliveryText } from "./webhookPresentation";

const fetchMock = vi.fn();

function webhook(over: Partial<Webhook> = {}): Webhook {
  return {
    id: 1,
    name: "Delivery channel",
    host: "hooks.example.com",
    urlPreview: "https://hooks.example.com/path/with-a-token?…",
    eventTypes: ["task.created", "comment.created"],
    projectIds: [],
    active: true,
    disabledReason: null,
    consecutiveFailures: 0,
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:00:00.000Z",
    lastDelivery: null,
    ...over,
  };
}

type Handler = (init: RequestInit) => Response | Promise<Response>;
let routes: Record<string, Handler> = {};

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

beforeEach(() => {
  routes = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${path.split("?")[0]}`;
    const handler = routes[key];
    if (!handler) return Promise.resolve(json(404, { error: `unrouted ${key}` }));
    return Promise.resolve(handler(init));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<WebhooksPanel />, { wrapper });
}

function sentBody(key: string) {
  const call = fetchMock.mock.calls.find(
    ([p, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${String(p).split("?")[0]}` === key,
  );
  return call ? JSON.parse((call[1] as RequestInit).body as string) : undefined;
}

describe("WebhooksPanel", () => {
  it("shows a one-line explanation and an add action when there are no webhooks", async () => {
    routes["GET /api/webhooks"] = () => json(200, { webhooks: [] });
    renderPanel();
    expect(await screen.findByText("No webhooks yet")).toBeTruthy();
    expect(screen.getByText(/sends an event, such as a new task or comment/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add webhook" })).toBeTruthy();
  });

  it("lists a webhook with its host only, status, events and last delivery", async () => {
    routes["GET /api/webhooks"] = () =>
      json(200, {
        webhooks: [
          webhook({ lastDelivery: { status: "SUCCEEDED", statusCode: 200, at: new Date().toISOString() } }),
        ],
      });
    renderPanel();
    const row = await screen.findByTestId("webhook-1");
    expect(within(row).getByText("Delivery channel")).toBeTruthy();
    expect(within(row).getByText("hooks.example.com")).toBeTruthy();
    expect(row.textContent).not.toContain("with-a-token");
    expect(within(row).getByText("Active")).toBeTruthy();
    expect(within(row).queryByText("Format")).toBeNull();
    expect(within(row).getByText("Task created, Comment added")).toBeTruthy();
    expect(within(row).getByText("All visible projects")).toBeTruthy();
    expect(within(row).getByText("Delivered (200), just now")).toBeTruthy();
  });

  it("shows a disabled row with its reason and re-enables it", async () => {
    routes["GET /api/webhooks"] = () =>
      json(200, { webhooks: [webhook({ active: false, disabledReason: "10 deliveries in a row failed" })] });
    routes["PATCH /api/webhooks/1"] = () => json(200, { webhook: webhook() });
    renderPanel();
    const row = await screen.findByTestId("webhook-1");
    expect(within(row).getByText("Disabled")).toBeTruthy();
    expect(within(row).getByText("Disabled: 10 deliveries in a row failed")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(sentBody("PATCH /api/webhooks/1")).toEqual({ active: true }));
  });

  it("offers Rotate secret on every row", async () => {
    routes["GET /api/webhooks"] = () => json(200, { webhooks: [webhook(), webhook({ id: 2, name: "Second" })] });
    renderPanel();
    expect(within(await screen.findByTestId("webhook-1")).getByRole("button", { name: "Rotate secret" })).toBeTruthy();
    expect(within(screen.getByTestId("webhook-2")).getByRole("button", { name: "Rotate secret" })).toBeTruthy();
  });

  it("shows the result of Send test", async () => {
    routes["GET /api/webhooks"] = () => json(200, { webhooks: [webhook()] });
    routes["POST /api/webhooks/1/test"] = () => json(200, { ok: false, statusCode: 503, error: "http_503" });
    renderPanel();
    const row = await screen.findByTestId("webhook-1");
    fireEvent.click(within(row).getByRole("button", { name: "Send test" }));
    expect(await within(row).findByText("Test failed: The receiver answered 503.")).toBeTruthy();
  });

  it("creates a webhook, sends the events in contract order, and shows the secret once", async () => {
    routes["GET /api/webhooks"] = () => json(200, { webhooks: [] });
    routes["GET /api/projects"] = () => json(200, []);
    routes["POST /api/webhooks"] = () => json(201, { webhook: webhook(), secret: "whsec_topsecret" });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Add webhook" }));
    const dialog = await screen.findByRole("dialog", { name: "New webhook" });

    fireEvent.change(within(dialog).getByPlaceholderText("Delivery channel"), { target: { value: "Ops" } });
    fireEvent.change(within(dialog).getByPlaceholderText("https://example.com/hooks/solvro"), {
      target: { value: "https://example.com/h" },
    });
    // Ticked out of order on purpose.
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Comment added" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Task created" }));
    expect(within(dialog).getByText(/first 500 characters of the comment/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create webhook" }));

    expect(await screen.findByText("whsec_topsecret")).toBeTruthy();
    expect(screen.getByText(/will not be shown again/)).toBeTruthy();
    expect(sentBody("POST /api/webhooks")).toEqual({
      name: "Ops",
      url: "https://example.com/h",
        eventTypes: ["task.created", "comment.created"],
      projectIds: [],
    });

    fireEvent.click(screen.getByRole("button", { name: "I have saved it" }));
    await waitFor(() => expect(screen.queryByText("whsec_topsecret")).toBeNull());
  });

  it("shows the API's refusal inline and keeps the dialog open", async () => {
    routes["GET /api/webhooks"] = () => json(200, { webhooks: [] });
    routes["GET /api/projects"] = () => json(200, []);
    routes["POST /api/webhooks"] = () =>
      json(400, { error: "The address must use https.", code: "webhook_target_refused" });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Add webhook" }));
    const dialog = await screen.findByRole("dialog", { name: "New webhook" });
    fireEvent.change(within(dialog).getByPlaceholderText("Delivery channel"), { target: { value: "Ops" } });
    fireEvent.change(within(dialog).getByPlaceholderText("https://example.com/hooks/solvro"), {
      target: { value: "http://example.com/h" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Task created" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create webhook" }));
    expect(await within(dialog).findByText("The address must use https.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "New webhook" })).toBeTruthy();
  });

  it("asks for at least one event before sending anything", async () => {
    routes["GET /api/webhooks"] = () => json(200, { webhooks: [] });
    routes["GET /api/projects"] = () => json(200, []);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Add webhook" }));
    const dialog = await screen.findByRole("dialog", { name: "New webhook" });
    fireEvent.change(within(dialog).getByPlaceholderText("Delivery channel"), { target: { value: "Ops" } });
    fireEvent.change(within(dialog).getByPlaceholderText("https://example.com/hooks/solvro"), {
      target: { value: "https://example.com/h" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create webhook" }));
    expect(await within(dialog).findByText("Pick at least one event.")).toBeTruthy();
    expect(sentBody("POST /api/webhooks")).toBeUndefined();
  });

  it("rotates a secret after confirming and shows the new one once", async () => {
    routes["GET /api/webhooks"] = () => json(200, { webhooks: [webhook()] });
    routes["POST /api/webhooks/1/rotate-secret"] = () => json(200, { secret: "whsec_rotated" });
    renderPanel();
    const row = await screen.findByTestId("webhook-1");
    fireEvent.click(within(row).getByRole("button", { name: "Rotate secret" }));
    const confirm = await screen.findByRole("dialog", { name: "Rotate signing secret?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Rotate secret" }));
    expect(await screen.findByText("whsec_rotated")).toBeTruthy();
    expect(screen.getByText(/will not be shown again/)).toBeTruthy();
  });
});

describe("WebhooksPanel edit", () => {
  async function openEdit() {
    routes["GET /api/webhooks"] = () => json(200, { webhooks: [webhook()] });
    routes["GET /api/projects"] = () => json(200, []);
    routes["PATCH /api/webhooks/1"] = () => json(200, { webhook: webhook() });
    renderPanel();
    const row = await screen.findByTestId("webhook-1");
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    return screen.findByRole("dialog", { name: "Edit webhook" });
  }

  it("starts the URL empty, shows the redacted target, and keeps the stored URL when left blank", async () => {
    const dialog = await openEdit();
    expect(within(dialog).queryByText("Format")).toBeNull();
    expect(within(dialog).queryAllByRole("radio", { name: /Standard Webhooks|Google Chat/ })).toHaveLength(0);
    expect((within(dialog).getByPlaceholderText("https://example.com/hooks/solvro") as HTMLInputElement).value).toBe("");
    expect(within(dialog).getByTestId("webhook-current-target").textContent).toBe(
      "https://hooks.example.com/path/with-a-token?…",
    );
    const hint = within(dialog).getByText("Leave blank to keep the current URL.");
    expect(within(dialog).getByPlaceholderText("https://example.com/hooks/solvro").getAttribute("aria-describedby")).toBe(hint.id);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(sentBody("PATCH /api/webhooks/1")).toBeDefined());
    expect(sentBody("PATCH /api/webhooks/1")).not.toHaveProperty("url");
  });

  it("sends the URL only when one is typed", async () => {
    const dialog = await openEdit();
    fireEvent.change(within(dialog).getByPlaceholderText("https://example.com/hooks/solvro"), {
      target: { value: " https://new.example.com/h " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(sentBody("PATCH /api/webhooks/1")).toBeDefined());
    expect(sentBody("PATCH /api/webhooks/1").url).toBe("https://new.example.com/h");
  });
});

describe("webhookPresentation", () => {
  it("maps delivery error codes to sentences, with a generic fallback", () => {
    expect(deliveryErrorLabel("http_500")).toBe("The receiver answered 500.");
    expect(deliveryErrorLabel("timeout")).toBe("The receiver did not answer in time.");
    expect(deliveryErrorLabel("target_private")).toMatch(/private network/);
    expect(deliveryErrorLabel("secret_unreadable")).toMatch(/Rotate the secret/);
    expect(deliveryErrorLabel("something_new")).toBe("The request failed.");
  });

  it("summarises events compactly", () => {
    expect(eventsSummary(["task.created"])).toBe("Task created");
    expect(eventsSummary(["task.created", "task.assigned", "risk.created"])).toBe("Task created and 2 more");
    expect(
      eventsSummary([
        "task.created",
        "task.status_changed",
        "task.assigned",
        "task.due_date_changed",
        "task.completed",
        "comment.created",
        "project.created",
        "risk.created",
      ]),
    ).toBe("All events");
  });

  it("words the last delivery", () => {
    expect(lastDeliveryText(null)).toBe("No deliveries yet");
    const at = new Date().toISOString();
    expect(lastDeliveryText({ status: "FAILED", statusCode: 500, at })).toBe("Failed (500), just now");
    expect(lastDeliveryText({ status: "FAILED", statusCode: null, at })).toBe("Failed, just now");
  });
});
