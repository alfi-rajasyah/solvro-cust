import { useId, type Ref } from "react";
import { OUTLINE_URL_MAX_LENGTH } from "@/lib/outlineUrl";

// Optional "Outline URL" form field shared by the project and customer forms.
// The caller owns validation (parseOutlineUrl): it passes the inline error and
// an `inputRef` to move focus to the field when a check fails. A text input
// (not `type="url"`) so the browser's own validation bubble never competes
// with the inline message.
export function OutlineUrlField({
  value,
  onChange,
  error,
  noun,
  inputClassName,
  inputRef,
}: {
  value: string;
  onChange: (next: string) => void;
  error: string | null;
  /** "project" or "customer" — only used in the helper text. */
  noun: "project" | "customer";
  inputClassName: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const helperId = `${id}-help`;
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-label-caps uppercase text-on-surface-variant"
      >
        Outline URL
      </label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        name="outlineUrl"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://…"
        maxLength={OUTLINE_URL_MAX_LENGTH + 64}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={helperId}
        className={inputClassName}
      />
      <p
        id={helperId}
        className={["mt-1 text-meta", error ? "text-error" : "text-on-surface-variant"].join(" ")}
      >
        {error ??
          `Link to this ${noun}'s Outline page or collection. Opens in a new tab. Leave empty for no link.`}
      </p>
    </div>
  );
}
