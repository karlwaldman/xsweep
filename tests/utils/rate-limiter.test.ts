import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { delay } from "@/utils/rate-limiter";

describe("delay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after at least minSec seconds", async () => {
    const promise = delay(2, 4);
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    // At 1.9s it should NOT have resolved
    await vi.advanceTimersByTimeAsync(1900);
    expect(resolved).toBe(false);

    // At 4.1s it must have resolved (max possible delay)
    await vi.advanceTimersByTimeAsync(2200);
    expect(resolved).toBe(true);
  });

  it("resolves before maxSec seconds", async () => {
    const promise = delay(1, 3);
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    // At 3.1s it must be resolved
    await vi.advanceTimersByTimeAsync(3100);
    expect(resolved).toBe(true);
  });
});
