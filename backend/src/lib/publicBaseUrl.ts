import { env } from "../env.js";
import { isLoopbackHost } from "./outline/appUrl.js";

/**
 * The address people reach Solvro on, from the operator's `APP_URL`, for links
 * that leave the app (guest links, Outline embeds). Null when `APP_URL` is
 * unset or names a loopback host (the dev default, or the `http://localhost`
 * that setup.sh saves when no address was given): a guest cannot open such a
 * link, so the client builds it from the address the owner has open instead.
 */
export function configuredPublicBaseUrl(): string | null {
  if (env.APP_URL === null) return null;
  if (isLoopbackHost(new URL(env.APP_URL).hostname)) return null;
  return env.APP_URL;
}
