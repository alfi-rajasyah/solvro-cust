import { useState } from "react";
import { ApiError } from "@/lib/api";
import { isOutlineAuthorizeUrl } from "@/lib/outlineUrl";
import { useOutlineConfig, useStartOutlineConnect } from "@/lib/queries";

/** Starts the OAuth round trip: the browser leaves for Outline's consent screen and returns to Settings. */
export function useConnectOutline() {
  const start = useStartOutlineConnect();
  const { data: config } = useOutlineConfig();
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setError(null);
    try {
      const { authorizeUrl } = await start.mutateAsync();
      // Only ever leave for the configured Outline: the URL comes from the server,
      // but a navigation to anywhere else would be an open redirect.
      if (!isOutlineAuthorizeUrl(authorizeUrl, config?.baseUrl)) {
        setError("Could not start the Outline connection. Try again.");
        return;
      }
      window.location.assign(authorizeUrl);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? err.message
          : "Could not start the Outline connection. Try again.",
      );
    }
  }
  return { connect, pending: start.isPending, error };
}
