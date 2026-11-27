// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelComments } from "./TaskDetail";
import type { Comment } from "@/lib/queries";

// The thread runs on the real hooks; only the HTTP layer and the session are
// faked, so optimistic writes, rollback and invalidation are the shipped ones.
const apiRequest = vi.fn();
const auth = { id: 1, permissions: ["task:comment"] as string[] };

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequest(...args) };
});
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    useAuth: () => ({
      status: "authenticated",
      userVerified: true,
      user: {
        id: auth.id,
        username: "me",
        email: "me@solvro.pl",
        role: "TAM",
        permissions: auth.permissions,
      },
    }),
  };
});

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }),
});

function comment(id: number, authorId: number, over: Partial<Comment> = {}): Comment {
  return {
    id,
    taskId: 7,
    authorId,
    body: `Body ${id}`,
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    editedAt: null,
    author: { id: authorId, username: authorId === 1 ? "me" : "other", email: "x@solvro.pl" },
    mentionedUserIds: [],
    source: null,
    inboundHook: null,
    ...over,
  };
}

let thread: Comment[];
let failWith: Error | null;
// While set, every thread GET waits on it: the refetch after a failed write is
// held, so a test reads the cache the rollback left, not a fresh server copy.
let gate: Promise<void> | null;
// While set, a PATCH waits on it (a save that is still in flight).
let patchGate: Promise<void> | null;

beforeEach(() => {
  thread = [comment(10, 1), comment(11, 2)];
  failWith = null;
  gate = null;
  patchGate = null;
  auth.id = 1;
  auth.permissions = ["task:comment"];
  apiRequest.mockReset();
  apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: { body: string } }) => {
    const method = opts?.method ?? "GET";
    if (path === "/tasks/7/comments" && method === "GET") {
      if (gate) await gate;
      return thread;
    }
    if (method === "PATCH" && patchGate) await patchGate;
    if (path.startsWith("/projects/3?")) return { id: 3, tam: { id: 1, username: "me" } };
    if (path === "/projects/3/members") return [{ userId: 2, username: "other" }];
    if (method === "PATCH" || method === "DELETE") {
      if (failWith) throw failWith;
      const id = Number(path.split("/").pop());
      if (method === "DELETE") {
        thread = thread.filter((c) => c.id !== id);
        return undefined;
      }
      thread = thread.map((c) =>
        c.id === id ? { ...c, body: opts!.body!.body, editedAt: new Date().toISOString() } : c,
      );
      return thread.find((c) => c.id === id);
    }
    return [];
  });
});

afterEach(cleanup);

let client: QueryClient;

function show(onOverlayChange?: (open: boolean) => void) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PanelComments taskId={7} projectId={3} onOverlayChange={onOverlayChange} />
    </QueryClientProvider>,
  );
}

async function waitForThread() {
  await screen.findByText("Body 10");
}

const menuButtons = () => screen.queryAllByRole("button", { name: "Comment actions" });

async function openMenuOf(index: number) {
  fireEvent.click(menuButtons()[index]);
}

describe("comment actions menu visibility", () => {
  it("shows the author a menu with Edit and Delete on their own comment only", async () => {
    show();
    await waitForThread();
    expect(menuButtons()).toHaveLength(1);
    await openMenuOf(0);
    expect(await screen.findByRole("menuitem", { name: /Edit/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toBeTruthy();
  });

  it("shows a non-author no menu", async () => {
    auth.id = 99;
    show();
    await waitForThread();
    expect(menuButtons()).toHaveLength(0);
  });

  it("gives an admin a menu on every comment, with Delete but Edit only on their own", async () => {
    auth.permissions = ["*"];
    show();
    await waitForThread();
    expect(menuButtons()).toHaveLength(2);
    await openMenuOf(1);
    await screen.findByRole("menuitem", { name: /Delete/ });
    expect(screen.queryByRole("menuitem", { name: /Edit/ })).toBeNull();
  });

  it("offers only Delete on a comment an incoming webhook wrote, even to its author", async () => {
    thread = [comment(10, 1, { source: "incoming" })];
    show();
    await waitForThread();
    await openMenuOf(0);
    await screen.findByRole("menuitem", { name: /Delete/ });
    expect(screen.queryByRole("menuitem", { name: /Edit/ })).toBeNull();
  });

  it("shows no menu to a user without task:comment", async () => {
    auth.permissions = ["project:read"];
    show();
    await waitForThread();
    expect(menuButtons()).toHaveLength(0);
  });
});

describe("editing a comment", () => {
  async function startEdit() {
    await waitForThread();
    await openMenuOf(0);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    return (await screen.findByRole("textbox", { name: "Edit comment" })) as HTMLTextAreaElement;
  }

  it("opens the editor on the current text and saves the new text through PATCH", async () => {
    show();
    const box = await startEdit();
    expect(box.value).toBe("Body 10");
    fireEvent.change(box, { target: { value: "Changed text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("/tasks/7/comments/10", {
        method: "PATCH",
        body: { body: "Changed text" },
      }),
    );
    await screen.findByText("Changed text");
    expect(screen.queryByRole("textbox", { name: "Edit comment" })).toBeNull();
    expect(await screen.findByTestId("comment-edited")).toBeTruthy();
  });

  it("saves on Enter", async () => {
    show();
    const box = await startEdit();
    fireEvent.change(box, { target: { value: "Via enter" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("/tasks/7/comments/10", {
        method: "PATCH",
        body: { body: "Via enter" },
      }),
    );
  });

  it("Cancel closes the editor without a request", async () => {
    show();
    const box = await startEdit();
    fireEvent.change(box, { target: { value: "Dropped" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "Edit comment" })).toBeNull();
    expect(screen.getByText("Body 10")).toBeTruthy();
    expect(apiRequest.mock.calls.some(([, o]) => o?.method === "PATCH")).toBe(false);
  });

  it("Escape cancels the edit and never reaches the panel's Escape listener", async () => {
    const panelEscape = vi.fn();
    document.addEventListener("keydown", panelEscape);
    try {
      show();
      const box = await startEdit();
      fireEvent.keyDown(box, { key: "Escape" });
      expect(screen.queryByRole("textbox", { name: "Edit comment" })).toBeNull();
      expect(panelEscape).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", panelEscape);
    }
  });

  it("rolls the thread back and shows the error inline when the save fails", async () => {
    show();
    const box = await startEdit();
    failWith = new Error("You can only edit your own comments.");
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    try {
      fireEvent.change(box, { target: { value: "Will fail" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect((await screen.findByRole("alert")).textContent).toContain("You can only edit your own comments.");
      // The editor stays open with the draft. The refetch is still held, so the
      // original text that shows after Cancel is the rollback, not a server copy.
      expect((screen.getByRole("textbox", { name: "Edit comment" }) as HTMLTextAreaElement).value).toBe("Will fail");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.getByText("Body 10")).toBeTruthy();
      expect(screen.queryByText("Will fail")).toBeNull();
    } finally {
      release();
    }
  });
});

describe("deleting a comment", () => {
  async function askToDelete() {
    await waitForThread();
    await openMenuOf(0);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    return screen.findByRole("dialog");
  }

  it("asks first, and the DELETE request goes out only on confirm", async () => {
    const overlay = vi.fn();
    show(overlay);
    const dialog = await askToDelete();
    expect(dialog.textContent).toContain("Delete this comment?");
    expect(apiRequest.mock.calls.some(([, o]) => o?.method === "DELETE")).toBe(false);
    expect(overlay).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("/tasks/7/comments/10", { method: "DELETE" }),
    );
    await waitFor(() => expect(screen.queryByText("Body 10")).toBeNull());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(overlay).toHaveBeenLastCalledWith(false);
  });

  it("Cancel leaves the comment and sends nothing", async () => {
    show();
    await askToDelete();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Body 10")).toBeTruthy();
    expect(apiRequest.mock.calls.some(([, o]) => o?.method === "DELETE")).toBe(false);
  });

  it("brings the comment back and says why when the delete fails", async () => {
    show();
    await askToDelete();
    failWith = new Error("Comment not found.");
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    try {
      fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));
      expect((await screen.findByRole("alert")).textContent).toContain("Comment not found.");
      // The refetch is held: the comment is back from the rollback alone.
      expect(screen.getByText("Body 10")).toBeTruthy();
      expect(screen.getByRole("dialog")).toBeTruthy();
    } finally {
      release();
    }
  });
});

// The panel's own Escape rule (TaskPanel.tsx): a capture listener snapshots
// whether an overlay was open, and the bubble listener closes only when none was.
function mountPanelEscape() {
  const state = { overlay: false, blocked: false, closed: 0 };
  const snapshot = (e: KeyboardEvent) => {
    if (e.key === "Escape") state.blocked = state.overlay;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !state.blocked) state.closed++;
  };
  document.addEventListener("keydown", snapshot, true);
  document.addEventListener("keydown", onKey);
  return {
    state,
    setOverlay: (open: boolean) => {
      state.overlay = open;
    },
    dispose: () => {
      document.removeEventListener("keydown", snapshot, true);
      document.removeEventListener("keydown", onKey);
    },
  };
}

describe("Escape never closes the panel behind an open comment overlay", () => {
  it("leaves the panel open when Escape closes the actions menu", async () => {
    const panel = mountPanelEscape();
    try {
      show(panel.setOverlay);
      await waitForThread();
      await openMenuOf(0);
      const item = await screen.findByRole("menuitem", { name: /Edit/ });
      fireEvent.keyDown(item, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menuitem", { name: /Edit/ })).toBeNull());
      expect(panel.state.closed).toBe(0);
    } finally {
      panel.dispose();
    }
  });

  it("leaves the panel open when Escape closes the delete confirm", async () => {
    const panel = mountPanelEscape();
    try {
      show(panel.setOverlay);
      await waitForThread();
      await openMenuOf(0);
      fireEvent.click(await screen.findByRole("menuitem", { name: /Delete/ }));
      await screen.findByRole("dialog");
      fireEvent.keyDown(document.body, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(panel.state.closed).toBe(0);
    } finally {
      panel.dispose();
    }
  });

  it.each(["Save", "Cancel"])("cancels the edit and leaves the panel open when Escape comes from %s", async (name) => {
    const panel = mountPanelEscape();
    try {
      show(panel.setOverlay);
      await waitForThread();
      await openMenuOf(0);
      fireEvent.click(await screen.findByRole("menuitem", { name: /Edit/ }));
      await screen.findByRole("textbox", { name: "Edit comment" });
      fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Escape" });
      expect(screen.queryByRole("textbox", { name: "Edit comment" })).toBeNull();
      expect(panel.state.closed).toBe(0);
    } finally {
      panel.dispose();
    }
  });

  it("ignores Escape while the save is pending, without closing the panel", async () => {
    const panel = mountPanelEscape();
    let release!: () => void;
    patchGate = new Promise<void>((r) => (release = r));
    try {
      show(panel.setOverlay);
      await waitForThread();
      await openMenuOf(0);
      fireEvent.click(await screen.findByRole("menuitem", { name: /Edit/ }));
      const box = await screen.findByRole("textbox", { name: "Edit comment" });
      fireEvent.change(box, { target: { value: "Slow save" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await screen.findByRole("button", { name: "Saving…" });
      fireEvent.keyDown(box, { key: "Escape" });
      fireEvent.keyDown(screen.getByRole("button", { name: "Saving…" }), { key: "Escape" });
      expect(screen.getByRole("textbox", { name: "Edit comment" })).toBeTruthy();
      expect(panel.state.closed).toBe(0);
    } finally {
      release();
      panel.dispose();
    }
  });
});

describe("focus after the editor or the dialog closes", () => {
  it("returns to the comment's actions button after Cancel and after Save", async () => {
    show();
    await waitForThread();
    await openMenuOf(0);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(menuButtons()[0]));

    await openMenuOf(0);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    const box = await screen.findByRole("textbox", { name: "Edit comment" });
    fireEvent.change(box, { target: { value: "Saved text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved text");
    await waitFor(() => expect(document.activeElement).toBe(menuButtons()[0]));
  });

  it("moves to the next comment's actions button after a delete, else to the main composer", async () => {
    auth.permissions = ["*"];
    thread = [comment(10, 1), comment(11, 2)];
    show();
    await waitForThread();
    await openMenuOf(0);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    await waitFor(() => expect(screen.queryByText("Body 10")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(menuButtons()[0]));

    // The last comment has no next one: focus lands on the composer.
    await openMenuOf(0);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    await waitFor(() => expect(screen.queryByText("Body 11")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Write a comment" })),
    );
  });
});

describe("editing a comment with mentions", () => {
  it("keeps the mentioned user ids in the PATCH body", async () => {
    thread = [comment(10, 1, { body: "hi @other there", mentionedUserIds: [2] })];
    show();
    await waitFor(() => expect(screen.getByTestId("mention-chip")).toBeTruthy());
    await openMenuOf(0);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    const box = await screen.findByRole("textbox", { name: "Edit comment" });
    expect(box.hasAttribute("placeholder")).toBe(false);
    fireEvent.change(box, { target: { value: "hi @other friend" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("/tasks/7/comments/10", {
        method: "PATCH",
        body: { body: "hi @other friend", mentionedUserIds: [2] },
      }),
    );
  });
});

describe("task row counts", () => {
  it("refreshes the project's task rows (comment badge) after adding and after deleting", async () => {
    show();
    await waitForThread();
    const spy = vi.spyOn(client, "invalidateQueries");
    const taskRowsInvalidated = () =>
      spy.mock.calls.some(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(["projects", 3, "tasks"]));

    fireEvent.change(screen.getByRole("textbox", { name: "Write a comment" }), { target: { value: "New one" } });
    fireEvent.click(screen.getByRole("button", { name: "Send comment" }));
    await waitFor(() => expect(taskRowsInvalidated()).toBe(true));

    spy.mockClear();
    await openMenuOf(0);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    await waitFor(() => expect(taskRowsInvalidated()).toBe(true));
  });
});

describe("edited mark", () => {
  it("shows 'edited' with the edit time only on a comment that was changed", async () => {
    thread = [comment(10, 1, { editedAt: "2026-11-27T14:22:00.000Z" }), comment(11, 2)];
    show();
    await waitForThread();
    const marks = screen.getAllByTestId("comment-edited");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("edited");
    expect(marks[0].getAttribute("title")).toMatch(/^Edited .+\d{2}:\d{2}$/);
  });
});
