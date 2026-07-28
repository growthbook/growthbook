import { applyVerifiedRestore } from "back-end/src/revisions/bulkPublish/verifiedRestore";

describe("applyVerifiedRestore", () => {
  it("returns without writing when there is nothing to restore", async () => {
    const write = jest.fn();
    await applyVerifiedRestore({
      restore: {},
      current: { a: 1 },
      write,
      label: 'config "x"',
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("passes when the write persists every intended key", async () => {
    const write = jest.fn(async (r: Record<string, unknown>) => Object.keys(r));
    await expect(
      applyVerifiedRestore({
        restore: { a: 1, b: 2 },
        current: { a: 9, b: 9 },
        write,
        label: 'config "x"',
      }),
    ).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledWith({ a: 1, b: 2 });
  });

  it("tolerates a dropped key that already equals its restore value (a no-op)", async () => {
    // `b` is dropped by the write's own no-op filter because it already holds
    // the restore value — that is a complete restore, not a partial one.
    const write = jest.fn(async () => ["a"]);
    await expect(
      applyVerifiedRestore({
        restore: { a: 1, b: 2 },
        current: { a: 9, b: 2 },
        write,
        label: 'config "x"',
      }),
    ).resolves.toBeUndefined();
  });

  it("throws when a needed key is dropped and still differs from current", async () => {
    // `b` was meant to change (current 9 ≠ restore 2) but the write dropped it
    // (e.g. normalization stripped it) — the restore is partial.
    const write = jest.fn(async () => ["a"]);
    await expect(
      applyVerifiedRestore({
        restore: { a: 1, b: 2 },
        current: { a: 9, b: 9 },
        write,
        label: 'config "x"',
      }),
    ).rejects.toThrow(/restore dropped field\(s\) b/);
  });

  it("uses deep equality for the no-op check", async () => {
    const write = jest.fn(async () => []);
    // Structurally-equal object dropped and already present → no-op, no throw.
    await expect(
      applyVerifiedRestore({
        restore: { a: { nested: [1, 2] } },
        current: { a: { nested: [1, 2] } },
        write,
        label: 'config "x"',
      }),
    ).resolves.toBeUndefined();
    // Structurally-different object dropped → partial, throws.
    await expect(
      applyVerifiedRestore({
        restore: { a: { nested: [1, 2] } },
        current: { a: { nested: [9] } },
        write,
        label: 'config "x"',
      }),
    ).rejects.toThrow(/restore dropped field\(s\) a/);
  });
});
