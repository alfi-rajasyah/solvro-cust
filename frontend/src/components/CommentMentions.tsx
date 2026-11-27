import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  activeMentionQuery,
  deriveMentionedIds,
  filterMentionCandidates,
  insertMention,
  splitComment,
  type MentionUser,
} from "@/lib/mentions";

/**
 * Comment text with the stored mentions shown as name chips
 * (docs/archive/plans/collaboration-and-sharing.md, C5c). Only `@username`
 * tokens of users in `mentionedUserIds` become chips; everything else is plain
 * text. Rendered as React text nodes only, so a body can never inject HTML.
 */
export function CommentBody({
  body,
  mentionedUserIds,
  users,
}: {
  body: string;
  mentionedUserIds: readonly number[] | undefined;
  users: readonly MentionUser[];
}) {
  const pieces = useMemo(() => splitComment(body, mentionedUserIds, users), [body, mentionedUserIds, users]);
  return (
    <p className="whitespace-pre-wrap wrap-break-word text-xs text-on-surface">
      {pieces.map((piece, i) =>
        piece.kind === "mention" ? (
          <span
            key={i}
            data-testid="mention-chip"
            className="rounded-sm bg-primary/10 px-1 py-px font-semibold text-primary-tint-text"
          >
            {piece.text}
          </span>
        ) : (
          <span key={i}>{piece.text}</span>
        ),
      )}
    </p>
  );
}

// On touch the on-screen Enter key is a newline and only Send sends; a
// hardware-keyboard desktop keeps Enter to send.
function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

/**
 * The comment box: an auto-growing textarea whose `@` opens a picker of the
 * project's people. Enter sends and Shift+Enter adds a line on desktop; on touch Enter adds
 * a line and only Send sends. The textarea keeps
 * focus and points at the picker's listbox with `aria-controls` /
 * `aria-activedescendant` (a textarea cannot take the combobox role, so it
 * stays a textbox with `aria-autocomplete="list"`).
 *
 * With `edit` it changes a posted comment instead: the box starts with that
 * text and its mentions, Save replaces the send icon, and Cancel or Escape
 * (with the picker shut) calls `edit.onCancel`.
 */
export function CommentComposer({
  candidates,
  isPending,
  error,
  onSend,
  edit,
}: {
  candidates: readonly MentionUser[];
  isPending: boolean;
  error: string | null;
  onSend: (body: string, mentionedUserIds: number[]) => Promise<void>;
  edit?: { initialBody: string; initialMentionIds: readonly number[]; onCancel: () => void };
}) {
  const listId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [body, setBody] = useState(edit?.initialBody ?? "");
  const [caret, setCaret] = useState(edit?.initialBody.length ?? 0);
  const [highlight, setHighlight] = useState(0);
  // `@` index the user dismissed with Escape; the picker stays shut until the
  // query moves to a different `@`.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  // Every name picked from the list. The ids sent are derived from which of
  // these are still in the text, so deleting a mention drops its id.
  const [recorded, setRecorded] = useState<MentionUser[]>(() =>
    candidates.filter((u) => edit?.initialMentionIds.includes(u.id)),
  );
  // The people list can arrive after the editor opens: the comment's own
  // mentions join the recorded picks as soon as their names are known.
  useEffect(() => {
    if (!edit) return;
    const known = candidates.filter((u) => edit.initialMentionIds.includes(u.id));
    setRecorded((r) => {
      const missing = known.filter((u) => !r.some((x) => x.id === u.id));
      return missing.length ? [...r, ...missing] : r;
    });
  }, [candidates, edit]);
  const pendingCaret = useRef<number | null>(null);

  const query = activeMentionQuery(body, caret);
  const matches = useMemo(
    () => (query ? filterMentionCandidates(candidates, query.query) : []),
    [candidates, query],
  );
  const open = query !== null && query.start !== dismissedAt && matches.length > 0;
  const active = Math.min(highlight, Math.max(0, matches.length - 1));

  // Grow with the content up to a cap, then scroll; reset on send (body "").
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight leaves out the border the edit box draws on the textarea itself.
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, [body]);

  // An editor opens ready to type, with the caret at the end of the text.
  const isEditing = edit !== undefined;
  useEffect(() => {
    const el = inputRef.current;
    if (!isEditing || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // Save and Cancel sit below the text: bring the whole editor into view.
    formRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [isEditing]);

  // Put the caret after an inserted mention once React has written the value.
  useEffect(() => {
    if (pendingCaret.current !== null && inputRef.current) {
      const pos = pendingCaret.current;
      pendingCaret.current = null;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(pos, pos);
      setCaret(pos);
    }
  }, [body]);

  function pick(user: MentionUser) {
    if (!query) return;
    const next = insertMention(body, query, caret, user.username);
    pendingCaret.current = next.caret;
    setBody(next.text);
    setRecorded((r) => (r.some((u) => u.id === user.id) ? r : [...r, user]));
    setHighlight(0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter/Tab/arrows during IME composition belong to the IME, not the picker.
    // Safari fires the confirming keydown after compositionend, with keyCode 229.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (!open) {
      if (e.key === "Escape" && edit) {
        // Cancels this edit only, not the task panel behind it.
        e.preventDefault();
        e.stopPropagation();
        if (!isPending) edit.onCancel();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !isCoarsePointer()) {
        e.preventDefault();
        e.currentTarget.form?.requestSubmit();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((active + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((active - 1 + matches.length) % matches.length);
    } else if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === "Escape") {
      // Closes the picker only, not the task panel behind it.
      e.preventDefault();
      e.stopPropagation();
      setDismissedAt(query?.start ?? null);
    }
  }

  // Escape from the Save or Cancel button (the textarea handles its own, with
  // the picker first) cancels the edit and never reaches the panel behind it.
  function handleFormKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (!edit || e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (!isPending) edit.onCancel();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || isPending) return;
    try {
      await onSend(trimmed, deriveMentionedIds(trimmed, recorded));
      if (edit) return;
      setBody("");
      setRecorded([]);
      setCaret(0);
    } catch {
      // surfaced through `error`
    }
  }

  return (
    <>
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        onKeyDown={handleFormKeyDown}
        // Editing: the textarea is the bordered box and Save and Cancel sit under it, outside the border.
        className={
          edit
            ? "relative flex flex-col gap-2"
            : "relative flex [@media(pointer:coarse)]:min-h-11 items-end gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30"
        }
      >
        <textarea
          ref={inputRef}
          rows={edit ? 3 : 1}
          aria-label={edit ? "Edit comment" : "Write a comment"}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          enterKeyHint={isCoarsePointer() ? "enter" : "send"}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            // Starting over (no `@query` left) re-arms a picker Escape closed.
            if (!activeMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)) {
              setDismissedAt(null);
            }
            setHighlight(0);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={handleKeyDown}
          maxLength={5000}
          placeholder={edit ? undefined : "Write a comment…"}
          className={
            edit
              ? "block max-h-48 w-full min-w-0 resize-none rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-xs text-on-surface outline-hidden focus:border-primary focus:ring-2 focus:ring-primary/30"
              : "max-h-40 min-w-0 flex-1 resize-none border-none bg-transparent text-xs [@media(pointer:coarse)]:py-1.5 text-on-surface outline-hidden placeholder:text-on-surface-variant/80"
          }
        />
        {edit ? (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={edit.onCancel}
              disabled={isPending}
              className="[@media(pointer:coarse)]:min-h-11 rounded-sm border border-outline-variant px-3 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50 focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !body.trim()}
              className="[@media(pointer:coarse)]:min-h-11 rounded-sm bg-primary px-3 py-1 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-50 outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
          </div>
        ) : (
          <button
            type="submit"
            disabled={isPending || !body.trim()}
            aria-label="Send comment"
            className="tap-target flex shrink-0 items-center self-end text-primary disabled:opacity-40"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[17px]">send</span>
          </button>
        )}

        <span role="status" className="sr-only">
          {open
            ? `${matches.length} ${matches.length === 1 ? "person" : "people"} found. Use up and down arrows to choose.`
            : ""}
        </span>

        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Mention someone"
            className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-48 overflow-y-auto rounded-sm border border-outline-variant bg-surface-container-lowest py-1 shadow-overlay"
          >
            {matches.map((user, i) => (
              <li
                key={user.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown, not click: the input must keep focus.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(user);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`cursor-pointer truncate px-3 py-1.5 text-xs text-on-surface ${
                  i === active ? "bg-surface-container-high" : ""
                }`}
              >
                <span className="text-on-surface-variant">@</span>
                {user.username}
              </li>
            ))}
          </ul>
        )}
      </form>
      {error && <p role="alert" className="text-meta text-error">
          {error}
        </p>}
    </>
  );
}
