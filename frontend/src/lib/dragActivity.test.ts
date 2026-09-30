import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { beginDrag, isDragActive, shouldPauseRefresh } from "./dragActivity";
import { LIVE_REFRESH_MS, liveRefreshOptions, subscribeRefreshGate } from "./queries";

// query-core skips interval timers when `window` is undefined (its `isServer`
// check runs at import time), so stub one before the imports above evaluate.
vi.hoisted(() => {
  (globalThis as { window?: unknown }).window ??= {};
});

const releases: Array<() => void> = [];
afterEach(() => {
  while (releases.length) releases.pop()!();
});
const begin = () => {
  const r = beginDrag();
  releases.push(r);
  return r;
};

describe("drag activity store", () => {
  it("is inactive by default and active between begin and release", () => {
    expect(isDragActive()).toBe(false);
    const end = begin();
    expect(isDragActive()).toBe(true);
    end();
    expect(isDragActive()).toBe(false);
  });

  it("release is idempotent and never clears another gesture's flag", () => {
    const a = begin();
    const b = begin();
    a();
    a(); // double end (drop + unmount cleanup) must not release b
    expect(isDragActive()).toBe(true);
    b();
    expect(isDragActive()).toBe(false);
  });
});

describe("shouldPauseRefresh", () => {
  it("pauses for a live drag or any pending mutation, not otherwise", () => {
    expect(shouldPauseRefresh(0)).toBe(false);
    expect(shouldPauseRefresh(1)).toBe(true);
    begin();
    expect(shouldPauseRefresh(0)).toBe(true);
  });
});

describe("liveRefreshOptions", () => {
  const client = (n: number) => ({ isMutating: () => n });

  it("polls every 30 s, visible tab only, when idle", () => {
    const o = liveRefreshOptions(client(0));
    expect(LIVE_REFRESH_MS).toBe(30_000);
    expect(o.refetchInterval()).toBe(30_000);
    expect(o.refetchOnWindowFocus()).toBe(true);
    expect(o.refetchIntervalInBackground).toBe(false);
  });

  it("returns false for the interval and focus while a mutation is pending or a drag is live", () => {
    const busy = liveRefreshOptions(client(2));
    expect(busy.refetchInterval()).toBe(false);
    expect(busy.refetchOnWindowFocus()).toBe(false);
    const idle = liveRefreshOptions(client(0));
    const end = begin();
    expect(idle.refetchInterval()).toBe(false);
    expect(idle.refetchOnWindowFocus()).toBe(false);
    end();
    expect(idle.refetchInterval()).toBe(30_000);
  });
});

// Real QueryObserver + fake timers: query-core evaluates `refetchInterval`
// only on query update / options re-set, so the gate has to re-set the
// observer's options when it flips. `subscribeRefreshGate` is what
// `useLiveRefresh` re-renders on; here its listener plays the re-render.
describe("live refresh against a real QueryObserver", () => {
  let qc: QueryClient;
  let fetches: number;
  let observer: QueryObserver<number>;
  let unsubscribe: () => void;

  const options = () => ({
    queryKey: ["live"],
    queryFn: () => Promise.resolve(++fetches),
    ...liveRefreshOptions(qc),
  });
  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  beforeEach(async () => {
    vi.useFakeTimers();
    qc = new QueryClient();
    fetches = 0;
    observer = new QueryObserver<number>(qc, options());
    unsubscribe = observer.subscribe(() => {});
    await tick(0);
  });
  afterEach(() => {
    unsubscribe();
    qc.clear();
    vi.useRealTimers();
  });

  const wireGate = () =>
    subscribeRefreshGate(qc, () => observer.setOptions(options()));

  it("refetches every 30 s while idle", async () => {
    expect(fetches).toBe(1);
    await tick(30_000);
    expect(fetches).toBe(2);
    await tick(30_000);
    expect(fetches).toBe(3);
  });

  it("pauses an armed interval mid-drag without any external re-render, and resumes after release", async () => {
    const off = wireGate();
    await tick(10_000);
    const end = begin();
    await tick(90_000);
    expect(fetches).toBe(1); // no tick fired during the drag
    end();
    await tick(29_000);
    expect(fetches).toBe(1);
    await tick(1_000);
    expect(fetches).toBe(2); // re-armed on release
    await tick(30_000);
    expect(fetches).toBe(3);
    off();
  });

  it("pauses while any mutation is pending and resumes once it settles", async () => {
    const off = wireGate();
    let finish!: () => void;
    const mutation = new MutationObserver(qc, {
      mutationFn: () => new Promise<void>((resolve) => (finish = resolve)),
    });
    const pending = mutation.mutate();
    await tick(0);
    expect(qc.isMutating()).toBe(1);
    await tick(90_000);
    expect(fetches).toBe(1);
    finish();
    await pending;
    await tick(0);
    expect(qc.isMutating()).toBe(0);
    await tick(30_000);
    expect(fetches).toBe(2);
    off();
  });
});
