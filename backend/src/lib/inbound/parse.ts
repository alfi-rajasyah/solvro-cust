// Body types the incoming webhook URL accepts (docs/archive/plans/webhooks.md,
// Phase 2): JSON, a form with the JSON in a `payload` field (GitHub's form
// option) and plain text. The parser never echoes any part of the body in an
// error: a body can carry a customer's text.
import { HttpError } from "../../http/errors.js";

export type InboundBody = { kind: "json"; value: unknown } | { kind: "text"; value: string };

/** The media type without parameters, lower-cased ("" when the header is absent). */
function mediaType(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

export function parseInboundBody(contentType: string | undefined, raw: Buffer): InboundBody {
  if (raw.length === 0) throw new HttpError(400, "empty_body", "The request has no body");
  const type = mediaType(contentType);
  const text = raw.toString("utf8");
  if (type === "application/json" || type.endsWith("+json")) {
    try {
      return { kind: "json", value: JSON.parse(text) };
    } catch {
      throw new HttpError(400, "invalid_json", "The body is not valid JSON");
    }
  }
  if (type === "application/x-www-form-urlencoded") {
    const form = new URLSearchParams(text);
    const payload = form.get("payload");
    if (payload !== null) {
      try {
        return { kind: "json", value: JSON.parse(payload) };
      } catch {
        throw new HttpError(400, "invalid_json", "The `payload` field is not valid JSON");
      }
    }
    // No `payload` field: scan the form's values as plain text.
    return { kind: "text", value: [...form.values()].join("\n") };
  }
  if (type === "text/plain") return { kind: "text", value: text };
  throw new HttpError(415, "unsupported_media_type", "Send application/json, a form with a `payload` field, or text/plain");
}
