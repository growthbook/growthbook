import {
  getActiveRunnerIds,
  trackActiveRunner,
  untrackActiveRunner,
  waitForActiveRunners,
} from "back-end/src/queryRunners/activeRunners";

const runner = (id: string) => ({ model: { id } });

async function isSettled(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(() => (settled = true));
  await new Promise((resolve) => setImmediate(resolve));
  return settled;
}

describe("activeRunners", () => {
  it("resolves the wait immediately when no runner is active", async () => {
    expect(getActiveRunnerIds()).toEqual([]);
    expect(await isSettled(waitForActiveRunners())).toBe(true);
  });

  it("reports the ids of active runners", () => {
    const a = runner("snp_a");
    const b = runner("snp_b");
    trackActiveRunner(a);
    trackActiveRunner(b);

    expect(getActiveRunnerIds()).toEqual(["snp_a", "snp_b"]);

    untrackActiveRunner(a);
    untrackActiveRunner(b);
    expect(getActiveRunnerIds()).toEqual([]);
  });

  it("resolves the wait only when the last runner is untracked", async () => {
    const a = runner("snp_a");
    const b = runner("snp_b");
    trackActiveRunner(a);
    trackActiveRunner(b);

    const idle = waitForActiveRunners();
    untrackActiveRunner(a);
    expect(await isSettled(idle)).toBe(false);

    untrackActiveRunner(b);
    expect(await isSettled(idle)).toBe(true);
  });

  it("ignores untracking a runner that is not active", async () => {
    const a = runner("snp_a");
    trackActiveRunner(a);

    const idle = waitForActiveRunners();
    expect(() => untrackActiveRunner(runner("snp_unknown"))).not.toThrow();
    expect(await isSettled(idle)).toBe(false);
    expect(getActiveRunnerIds()).toEqual(["snp_a"]);

    untrackActiveRunner(a);
    untrackActiveRunner(a);
    expect(await isSettled(idle)).toBe(true);
    expect(getActiveRunnerIds()).toEqual([]);
  });
});
