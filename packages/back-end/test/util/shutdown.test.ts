import { drainWithDeadline } from "back-end/src/util/shutdown";

const never = () => new Promise<void>(() => undefined);

describe("drainWithDeadline", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns no pending tasks once everything settles, without waiting out the deadline", async () => {
    const drained = drainWithDeadline(
      { a: Promise.resolve(), b: Promise.resolve().then(() => "later") },
      10000,
    );

    await expect(drained).resolves.toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("returns the names of tasks still running at the deadline", async () => {
    let pending: string[] | null = null;
    const drained = drainWithDeadline(
      { done: Promise.resolve(), stuck: never() },
      10000,
    ).then((names) => (pending = names));

    await jest.advanceTimersByTimeAsync(9999);
    expect(pending).toBeNull();

    await jest.advanceTimersByTimeAsync(1);
    await expect(drained).resolves.toEqual(["stuck"]);
  });

  it("counts a rejected task as settled", async () => {
    const drained = drainWithDeadline(
      { failed: Promise.reject(new Error("boom")), ok: Promise.resolve() },
      10000,
    );

    await expect(drained).resolves.toEqual([]);
  });

  it("returns pending tasks at once with a zero timeout", async () => {
    const drained = drainWithDeadline({ stuck: never() }, 0);

    await jest.advanceTimersByTimeAsync(0);
    await expect(drained).resolves.toEqual(["stuck"]);
  });
});
