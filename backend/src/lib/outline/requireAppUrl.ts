// Guard for code that builds Solvro-origin URLs for Outline (OAuth redirect URI,
// webhook link recognition). APP_URL has no production default, so it can be
// unset (docs/archive/plans/outline-integration.md, F13).
import { env } from "../../env.js";
import { HttpError } from "../../http/errors.js";

/** The configured public Solvro origin, or 409 `outline_app_url_unset`. */
export function requireAppUrl(): string {
  if (env.APP_URL === null) {
    throw new HttpError(
      409,
      "outline_app_url_unset",
      "Set APP_URL to the public Solvro address to use Outline sign-in and mentions.",
    );
  }
  return env.APP_URL;
}
