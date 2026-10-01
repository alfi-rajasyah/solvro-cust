import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { NEW_PARAM } from "@/lib/paletteActions";

/**
 * One-shot deep link into a page's create form (used by the ⌘K palette's
 * Actions group). When the URL carries `?new=<value>`, run `onOpen` (only if
 * `enabled`, i.e. the user may create) and strip the param so a refresh or
 * Back never reopens the form.
 */
export function useNewParam(value: string, enabled: boolean, onOpen: () => void): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get(NEW_PARAM) === value;
  useEffect(() => {
    if (!requested) return;
    if (enabled) onOpen();
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(NEW_PARAM);
        return next;
      },
      { replace: true },
    );
    // onOpen is a state setter closure; only the request itself should re-fire.
  }, [requested, enabled]);
}
