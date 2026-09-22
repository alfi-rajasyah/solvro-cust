// iTop REST/JSON (version 1.3) client. Pure module: no Prisma, no env, no
// logger — the caller (lib/itop/sync.ts, routes) owns configuration and
// logging. Never logs the token itself.
//
// Protocol reference: docs/archive/plans/itop-integration-spec.md
// "How it works", "What one pull looks like", "What one action looks like".

import type { ItopTicketClass } from "./types.js";

/** `code` is iTop's own numeric error code, or one of our transport codes. */
export type ItopErrorCode = number | "http" | "timeout" | "network" | "parse" | "paging";

export class ItopError extends Error {
  code: ItopErrorCode;
  status?: number;

  constructor(params: { code: ItopErrorCode; message: string; status?: number }) {
    super(params.message);
    this.name = "ItopError";
    this.code = params.code;
    this.status = params.status;
  }
}

export interface ItopClientOptions {
  baseUrl: string;
  token: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ItopObjectRow<T> {
  key: number;
  class: string;
  fields: T;
}

export interface ItopGetResult<T> {
  objects: Array<ItopObjectRow<T>>;
}

export interface ItopProbeResult {
  name: string;
  ok: boolean;
  message: string;
}

export interface ItopListOperationsResult {
  code: number;
  version: string;
  operations: Array<{ verb: string; description: string; extension: string }>;
}

export interface ItopClient {
  get<T>(
    cls: ItopTicketClass | string,
    key: number | string,
    outputFields: string,
    options?: { limit?: number; page?: number },
  ): Promise<ItopGetResult<T>>;
  getAll<T>(
    cls: ItopTicketClass | string,
    oql: string,
    outputFields: string,
    options?: { pageSize?: number },
  ): Promise<ItopGetResult<T>>;
  listOperations(): Promise<ItopListOperationsResult>;
  probe(): Promise<ItopProbeResult[]>;
  create<T>(
    cls: string,
    fields: Record<string, unknown>,
    comment?: string,
  ): Promise<ItopObjectRow<T> | undefined>;
  update<T>(
    cls: string,
    key: number | string,
    fields: Record<string, unknown>,
    comment?: string,
  ): Promise<ItopObjectRow<T> | undefined>;
  applyStimulus<T>(
    cls: string,
    key: number | string,
    stimulus: string,
    fields?: Record<string, unknown>,
    comment?: string,
  ): Promise<ItopObjectRow<T> | undefined>;
}

/** The classes `probe()` checks with `core/get limit:1`, in report order. */
const PROBE_CLASSES = ["Organization", "UserRequest", "Incident", "Person", "TimeSpent"] as const;

/**
 * Hard ceiling on `getAll`'s page loop. A server that ignores `limit`/`page`
 * and keeps answering with a full page forever would otherwise spin an
 * unattended scheduler tick indefinitely.
 */
const MAX_GETALL_PAGES = 500;

interface ItopObjectEnvelope {
  code: number;
  message: string;
  class: string;
  key: string;
  fields: Record<string, unknown>;
}

interface ItopEnvelope {
  code: number;
  message: string;
  objects?: Record<string, ItopObjectEnvelope> | null;
  version?: string;
  operations?: Array<{ verb: string; description: string; extension: string }>;
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

function flattenObjects<T>(objects: Record<string, ItopObjectEnvelope> | null | undefined): Array<ItopObjectRow<T>> {
  if (!objects) return [];
  return Object.values(objects).map((entry) => ({
    key: Number(entry.key),
    class: entry.class,
    fields: entry.fields as T,
  }));
}

function toErrorMessage(err: unknown): string {
  if (err instanceof ItopError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

export function createItopClient(options: ItopClientOptions): ItopClient {
  const baseUrl = stripTrailingSlashes(options.baseUrl);
  const token = options.token;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15000;
  const endpoint = `${baseUrl}/webservices/rest.php?version=1.3`;

  async function request(payload: Record<string, unknown>): Promise<ItopEnvelope> {
    const body = new URLSearchParams({ json_data: JSON.stringify(payload) }).toString();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeoutError = () =>
      new ItopError({ code: "timeout", message: `iTop request timed out after ${timeoutMs}ms` });
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(timeoutError());
      }, timeoutMs);
    });

    // `work` covers the whole round trip — the fetch call AND reading the
    // response body — so a server that sends headers promptly but stalls
    // the body can't hang past `timeoutMs` either. Racing only the fetch()
    // call (the earlier bug here) left `response.json()` unbounded.
    const work = (async (): Promise<ItopEnvelope> => {
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "Auth-Token": token,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw timeoutError();
        throw new ItopError({ code: "network", message: toErrorMessage(err) });
      }

      if (!response.ok) {
        throw new ItopError({
          code: "http",
          message: `iTop responded with HTTP ${response.status}`,
          status: response.status,
        });
      }

      try {
        return (await response.json()) as ItopEnvelope;
      } catch {
        throw new ItopError({ code: "parse", message: "iTop response was not valid JSON" });
      }
    })();

    let parsed: ItopEnvelope;
    try {
      parsed = await Promise.race([work, timeoutPromise]);
    } finally {
      clearTimeout(timer!);
      // If the timeout won the race, `work` is still in flight — attach a
      // no-op handler so its eventual settlement never surfaces as an
      // unhandled rejection.
      work.catch(() => {});
    }

    if (parsed.code !== 0) {
      throw new ItopError({ code: parsed.code, message: parsed.message });
    }

    return parsed;
  }

  async function get<T>(
    cls: string,
    key: number | string,
    outputFields: string,
    getOptions: { limit?: number; page?: number } = {},
  ): Promise<ItopGetResult<T>> {
    const payload: Record<string, unknown> = {
      operation: "core/get",
      class: cls,
      key,
      output_fields: outputFields,
    };
    if (getOptions.limit !== undefined) payload.limit = getOptions.limit;
    if (getOptions.page !== undefined) payload.page = getOptions.page;

    const raw = await request(payload);
    return { objects: flattenObjects<T>(raw.objects) };
  }

  async function getAll<T>(
    cls: string,
    oql: string,
    outputFields: string,
    getAllOptions: { pageSize?: number } = {},
  ): Promise<ItopGetResult<T>> {
    const pageSize = getAllOptions.pageSize ?? 100;
    const rows: Array<ItopObjectRow<T>> = [];
    const seenKeys = new Set<number>();
    let page = 1;

    for (;;) {
      if (page > MAX_GETALL_PAGES) {
        throw new ItopError({
          code: "paging",
          message: `iTop getAll exceeded ${MAX_GETALL_PAGES} pages for class '${cls}' — the server may be ignoring limit/page`,
        });
      }

      const result = await get<T>(cls, oql, outputFields, { limit: pageSize, page });
      let newRows = 0;
      for (const row of result.objects) {
        if (!seenKeys.has(row.key)) {
          seenKeys.add(row.key);
          rows.push(row);
          newRows += 1;
        }
      }

      if (result.objects.length < pageSize) break;
      // A full page that contributed nothing new means the server isn't
      // advancing with `page` (or is repeating results) — stop instead of
      // looping toward MAX_GETALL_PAGES on data that will never change.
      if (newRows === 0) break;
      page += 1;
    }
    return { objects: rows };
  }

  async function listOperations(): Promise<ItopListOperationsResult> {
    const raw = await request({ operation: "list_operations" });
    return {
      code: raw.code,
      version: raw.version ?? "",
      operations: raw.operations ?? [],
    };
  }

  async function probe(): Promise<ItopProbeResult[]> {
    const results: ItopProbeResult[] = [];

    try {
      await listOperations();
      results.push({ name: "list_operations", ok: true, message: "ok" });
    } catch (err) {
      results.push({ name: "list_operations", ok: false, message: toErrorMessage(err) });
    }

    for (const cls of PROBE_CLASSES) {
      // TimeSpent's attribute codes vary by Time Tracking extension version
      // (plan risk: "Time Tracking schema differs on the real install") —
      // ask for every field so the probe message tells Phase 3 what's
      // actually there, instead of just confirming the class is readable.
      const outputFields = cls === "TimeSpent" ? "*" : "id";
      try {
        const result = await get<Record<string, unknown>>(cls, `SELECT ${cls}`, outputFields, { limit: 1 });
        if (cls === "TimeSpent") {
          const fieldNames = result.objects[0] ? Object.keys(result.objects[0].fields).sort().join(",") : "";
          results.push({
            name: cls,
            ok: true,
            message: fieldNames || "ok (no rows to inspect)",
          });
        } else {
          results.push({ name: cls, ok: true, message: "ok" });
        }
      } catch (err) {
        results.push({ name: cls, ok: false, message: toErrorMessage(err) });
      }
    }

    return results;
  }

  async function create<T>(
    cls: string,
    fields: Record<string, unknown>,
    comment?: string,
  ): Promise<ItopObjectRow<T> | undefined> {
    const payload: Record<string, unknown> = { operation: "core/create", class: cls, fields };
    if (comment !== undefined) payload.comment = comment;
    const raw = await request(payload);
    return flattenObjects<T>(raw.objects)[0];
  }

  async function update<T>(
    cls: string,
    key: number | string,
    fields: Record<string, unknown>,
    comment?: string,
  ): Promise<ItopObjectRow<T> | undefined> {
    const payload: Record<string, unknown> = { operation: "core/update", class: cls, key, fields };
    if (comment !== undefined) payload.comment = comment;
    const raw = await request(payload);
    return flattenObjects<T>(raw.objects)[0];
  }

  async function applyStimulus<T>(
    cls: string,
    key: number | string,
    stimulus: string,
    fields: Record<string, unknown> = {},
    comment?: string,
  ): Promise<ItopObjectRow<T> | undefined> {
    const payload: Record<string, unknown> = {
      operation: "core/apply_stimulus",
      class: cls,
      key,
      stimulus,
      fields,
    };
    if (comment !== undefined) payload.comment = comment;
    const raw = await request(payload);
    return flattenObjects<T>(raw.objects)[0];
  }

  return { get, getAll, listOperations, probe, create, update, applyStimulus };
}
