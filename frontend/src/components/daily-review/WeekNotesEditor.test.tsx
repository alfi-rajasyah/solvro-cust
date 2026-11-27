// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import { NOTE_BODY_MAX, WeekNotesEditor, type WeekNoteBase } from "./WeekNotesEditor";

afterEach(cleanup);

const today = "2026-11-18";
const days = ["2026-11-16", "2026-11-17", today];

function renderEditor(
  props: { onAdd?: () => Promise<unknown>; onUpdate?: () => Promise<unknown>; notes?: WeekNoteBase[] } = {},
) {
  return render(
    <WeekNotesEditor
      days={days}
      today={today}
      notes={props.notes ?? []}
      currentUserId={1}
      canDeleteAny={false}
      placeholder="Note"
      ariaLabel="Note for Acme"
      fieldLabel="Note"
      rowsId="rows"
      onAdd={props.onAdd ?? (() => Promise.resolve())}
      onUpdate={props.onUpdate ?? (() => Promise.resolve())}
      onDelete={() => {}}
      addPending={false}
      updatePending={false}
      deletePending={false}
    />,
  );
}

const box = () => screen.getByLabelText("Note for Acme") as HTMLTextAreaElement;

describe("WeekNotesEditor save handling", () => {
  it("keeps the draft and shows the server message when the add fails", async () => {
    const onAdd = vi.fn().mockRejectedValue(new ApiError(400, "body too long", null));
    renderEditor({ onAdd });
    fireEvent.change(box(), { target: { value: "my note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    const alert = await screen.findByTestId("note-save-error");
    expect(alert.textContent).toContain("Could not save the note: body too long");
    expect(box().value).toBe("my note");
  });

  it("clears the draft and shows no error when the add succeeds", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    renderEditor({ onAdd });
    fireEvent.change(box(), { target: { value: "my note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(box().value).toBe(""));
    expect(onAdd).toHaveBeenCalledWith(today, "my note", { title: "" });
    expect(screen.queryByTestId("note-save-error")).toBeNull();
  });

  it("does not clear the draft before the request settles", async () => {
    let resolve!: () => void;
    const onAdd = vi.fn().mockReturnValue(new Promise<void>((r) => (resolve = r)));
    renderEditor({ onAdd });
    fireEvent.change(box(), { target: { value: "slow" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(box().value).toBe("slow");
    resolve();
    await waitFor(() => expect(box().value).toBe(""));
  });

  it("keeps an edit open with its text when the update fails, and closes it on success", async () => {
    const note: WeekNoteBase = { id: 5, noteDate: `${today}T00:00:00.000Z`, body: "old", author: { id: 1, username: "me" } };
    const onUpdate = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(undefined);
    renderEditor({ notes: [note], onUpdate });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const edit = screen.getAllByLabelText("Note for Acme")[0] as HTMLTextAreaElement;
    fireEvent.change(edit, { target: { value: "new text" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save note" })[0]);
    await screen.findByTestId("note-save-error");
    expect((screen.getAllByLabelText("Note for Acme")[0] as HTMLTextAreaElement).value).toBe("new text");
    fireEvent.click(screen.getAllByRole("button", { name: "Save note" })[0]);
    await waitFor(() => expect(screen.queryByTestId("note-save-error")).toBeNull());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull());
  });

  it("caps the textarea at the backend limit and shows a counter near it", () => {
    renderEditor();
    expect(box().maxLength).toBe(NOTE_BODY_MAX);
    expect(screen.queryByTestId("note-char-count")).toBeNull();
    fireEvent.change(box(), { target: { value: "x".repeat(3600) } });
    expect(screen.getByTestId("note-char-count").textContent).toBe("3600 / 4000");
  });
});
