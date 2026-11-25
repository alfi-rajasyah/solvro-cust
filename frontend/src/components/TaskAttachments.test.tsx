// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import { TaskAttachments, formatBytes, formatMb, precheckFile, uploadErrorMessage } from "./TaskAttachments";

const config = {
  maxFileBytes: 25 * 1024 * 1024,
  maxFilesPerTask: 20,
  maxTaskBytes: 100 * 1024 * 1024,
  allowedExtensions: ["txt", "pdf", "png"],
};
const rows = [
  {
    id: 1,
    fileName: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 2048,
    createdAt: "2026-11-20T10:00:00.000Z",
    uploadedBy: { id: 1, name: "Ada Nowak" },
  },
];

const refetchConfig = vi.fn();
const state = { items: rows as unknown[], cfg: { data: config as unknown, isError: false } };
const uploadAsync = vi.fn();
const deleteAsync = vi.fn();

vi.mock("@/lib/queries", () => ({
  useAttachmentConfig: () => ({ ...state.cfg, refetch: refetchConfig }),
  useTaskAttachments: () => ({ data: state.items, isLoading: false, isError: false, error: null }),
  useUploadAttachment: () => ({ mutateAsync: uploadAsync, isPending: false }),
  useDeleteAttachment: () => ({ mutateAsync: deleteAsync, isPending: false }),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiDownloadBlob: vi.fn(),
}));

beforeEach(() => {
  state.items = rows;
  state.cfg = { data: config, isError: false };
  refetchConfig.mockReset();
  uploadAsync.mockReset();
  deleteAsync.mockReset();
});
afterEach(cleanup);

function pick(files: File[]) {
  fireEvent.change(screen.getByTestId("attachment-input"), { target: { files } });
}

describe("TaskAttachments", () => {
  it("renders a row with name, size, uploader and a download control", () => {
    render(<TaskAttachments taskId={5} canEdit />);
    expect(screen.getByText("notes.txt")).toBeTruthy();
    expect(screen.getByText(/2 KB · Ada Nowak/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download notes.txt" })).toBeTruthy();
    expect(screen.getByText("Up to 25 MB per file, 20 files and 100 MB per task. Types: txt, pdf, png.")).toBeTruthy();
  });

  it("shows the empty line when there are no files", () => {
    state.items = [];
    render(<TaskAttachments taskId={5} canEdit />);
    expect(screen.getByText("No files yet.")).toBeTruthy();
  });

  it("hides upload and delete without task:write but keeps download", () => {
    render(<TaskAttachments taskId={5} canEdit={false} />);
    expect(screen.queryByRole("button", { name: "Attach files" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
    expect(screen.getByRole("button", { name: "Download notes.txt" })).toBeTruthy();
  });

  it("rejects an oversize file and a disallowed type without sending them", async () => {
    render(<TaskAttachments taskId={5} canEdit />);
    const big = new File(["x"], "big.pdf");
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 });
    pick([big, new File(["x"], "run.exe")]);
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    expect(screen.getByText("Files can be up to 25 MB.")).toBeTruthy();
    expect(screen.getByText(/This file type is not allowed\. Allowed types: txt, pdf, png\./)).toBeTruthy();
    expect(uploadAsync).not.toHaveBeenCalled();
  });

  it("uploads files one after another and shows a dismissible error row for a failure", async () => {
    uploadAsync
      .mockRejectedValueOnce(new ApiError(409, "A task can have up to 20 files.", { error: "x" }))
      .mockResolvedValueOnce({});
    render(<TaskAttachments taskId={5} canEdit />);
    pick([new File(["a"], "a.txt"), new File(["b"], "b.txt")]);
    await waitFor(() => expect(uploadAsync).toHaveBeenCalledTimes(2));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("a.txt")).toBeTruthy();
    expect(within(alert).getByText("A task can have up to 20 files.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error for a.txt" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains a disabled Attach button when the limits fail to load, with a retry", () => {
    state.cfg = { data: undefined, isError: true };
    render(<TaskAttachments taskId={5} canEdit />);
    expect((screen.getByRole("button", { name: "Attach files" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Could not load the upload limits/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetchConfig).toHaveBeenCalled();
  });

  it("asks before deleting", async () => {
    deleteAsync.mockResolvedValue(undefined);
    render(<TaskAttachments taskId={5} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Delete notes.txt" }));
    expect(await screen.findByText("Delete this file?")).toBeTruthy();
    expect(deleteAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete file" }));
    await waitFor(() => expect(deleteAsync).toHaveBeenCalledWith(1));
  });
});

describe("helpers", () => {
  it("formats sizes", () => {
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });

  it("words limits like the server", () => {
    expect(formatMb(25 * 1024 * 1024)).toBe("25 MB");
    expect(formatMb(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });

  it("prechecks count and total limits", () => {
    const f = { name: "a.txt", size: 10 };
    expect(precheckFile(f, config, { count: 20, bytes: 0 })).toMatch(/up to 20 files/);
    expect(precheckFile(f, config, { count: 1, bytes: config.maxTaskBytes })).toMatch(/100 MB/);
    expect(precheckFile(f, config, { count: 1, bytes: 0 })).toBeNull();
  });

  it("maps an HTML 413 to the size message and keeps JSON messages", () => {
    expect(uploadErrorMessage(new ApiError(413, "Request failed with status 413", "<html>"), config)).toBe(
      "Files can be up to 25 MB.",
    );
    expect(uploadErrorMessage(new ApiError(413, "Too big.", { error: "Too big." }), config)).toBe("Too big.");
  });
});
