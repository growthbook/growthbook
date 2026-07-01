import { createAsyncSnapshot } from "back-end/src/util/asyncSnapshot";

describe("createAsyncSnapshot", () => {
  it("loads once and shares the same result across concurrent and later gets", async () => {
    let calls = 0;
    const snap = createAsyncSnapshot(async () => {
      calls++;
      return [1, 2, 3];
    });

    const [a, b, c] = await Promise.all([snap.get(), snap.get(), snap.get()]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);

    await snap.get();
    expect(calls).toBe(1);
  });

  it("reloads after invalidate()", async () => {
    let calls = 0;
    const snap = createAsyncSnapshot(async () => {
      calls++;
      return calls;
    });

    expect(await snap.get()).toBe(1);
    expect(await snap.get()).toBe(1);

    snap.invalidate();
    expect(await snap.get()).toBe(2);
    expect(await snap.get()).toBe(2);
  });

  it("does not cache a rejection — the next get() retries", async () => {
    let calls = 0;
    const snap = createAsyncSnapshot(async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return calls;
    });

    await expect(snap.get()).rejects.toThrow("boom");
    expect(await snap.get()).toBe(2);
  });
});
