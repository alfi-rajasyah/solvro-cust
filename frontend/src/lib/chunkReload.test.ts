import { describe, expect, it, vi } from "vitest";
import { handleChunkLoadError } from "./chunkReload";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

function preloadError() {
  return { preventDefault: vi.fn() } as unknown as Event & { preventDefault: ReturnType<typeof vi.fn> };
}

describe("handleChunkLoadError", () => {
  it("reloads once and cancels the error for a chunk that failed to load", () => {
    const reload = vi.fn();
    const event = preloadError();
    handleChunkLoadError(event, memoryStorage(), reload, 1_000_000);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("does not reload again within the window, so a chunk still missing after a reload shows the error screen", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    handleChunkLoadError(preloadError(), storage, reload, 1_000_000);
    const second = preloadError();
    handleChunkLoadError(second, storage, reload, 1_005_000);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.preventDefault).not.toHaveBeenCalled();
    // Later failures (another deploy) reload again.
    handleChunkLoadError(preloadError(), storage, reload, 1_020_000);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does nothing when storage is blocked", () => {
    const reload = vi.fn();
    const blocked = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {},
    };
    handleChunkLoadError(preloadError(), blocked, reload, 1_000_000);
    expect(reload).not.toHaveBeenCalled();
  });
});
