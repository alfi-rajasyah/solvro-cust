const BASE_URL = "/api";

const TOKEN_STORAGE_KEY = "solvro.token";

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

  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

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
