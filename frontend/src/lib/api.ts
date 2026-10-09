const BASE_URL = "/api";

export const TOKEN_STORAGE_KEY = "solvro.token";

/** Fired on `window` when an authenticated request is answered with 401. */
export const UNAUTHENTICATED_EVENT = "solvro:unauthenticated";

/**
 * Fired on `window` when an authenticated request is answered with 403
 * `forbidden` (a missing permission). AuthProvider re-reads the account then,
 * so a role change made by an admin shows without a reload.
 */
export const FORBIDDEN_EVENT = "solvro:forbidden";

// True while this tab is swapping its session token (password change). The
// server bumps the token version before the response arrives, so requests
// already in flight with the old token answer 401 in that window; that must
// not sign the user out of the session that is being replaced.
let tokenRotating = false;
export function setTokenRotating(value: boolean): void {
  tokenRotating = value;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  auth?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await apiRequestWithHeaders<T>(path, options)).data;
}

/**
 * Same as `apiRequest`, but also returns the response headers, for the few
 * endpoints that carry data in one (e.g. `X-Total-Count` on `GET /tasks`).
 */
export async function apiRequestWithHeaders<T>(
  path: string,
  { method = "GET", body, signal, auth = true }: RequestOptions = {},
): Promise<{ data: T; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const token = auth ? getToken() : null;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  const text = await res.text();
  const parsed: unknown = text ? safeJsonParse(text) : null;

  if (!res.ok) {
    const message =
      isErrorBody(parsed) && typeof parsed.error === "string"
        ? parsed.error
        : `Request failed with status ${res.status}`;
    // A 401 on an authenticated request means the session is over: the token
    // expired, or the server revoked it (password change, admin reset,
    // deactivation — the account is checked on every request). AuthProvider
    // listens and signs the user out. Only when the rejected token is still
    // the current one: a late 401 from a previous session must not sign out
    // a fresh login. `null === null` is fine (a second tab whose token was
    // already cleared): sign-out is idempotent, and the unauthenticated calls
    // (login, Google, guest links) send `auth: false`.
    if (auth && res.status === 401 && getToken() === token && !tokenRotating) {
      window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
    }
    if (
      auth &&
      res.status === 403 &&
      isErrorBody(parsed) &&
      (parsed as { code?: unknown }).code === "forbidden"
    ) {
      window.dispatchEvent(new Event(FORBIDDEN_EVENT));
    }
    throw new ApiError(res.status, message, parsed);
  }

  return { data: parsed as T, headers: res.headers };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isErrorBody(value: unknown): value is { error?: unknown } {
  return typeof value === "object" && value !== null;
}
