import { FactFilterTestResults } from "shared/types/fact-table";
import { runNarrowThenWiden } from "back-end/src/services/factTableTestQueries";

function stubRun(responses: FactFilterTestResults[]) {
  const calls: number[] = [];
  const run = async (testDays: number) => {
    calls.push(testDays);
    return responses[calls.length - 1];
  };
  return { calls, run };
}

const rows = { sql: "narrow", results: [{ a: 1 }] };
const empty = { sql: "narrow", results: [] };

describe("runNarrowThenWiden", () => {
  it("runs one query over the last day when it returns rows", async () => {
    const { calls, run } = stubRun([rows]);
    expect(await runNarrowThenWiden(30, run)).toBe(rows);
    expect(calls).toEqual([1]);
  });

  it("retries over the org window when the first run has no rows", async () => {
    const wide = { sql: "wide", results: [{ a: 2 }] };
    const { calls, run } = stubRun([empty, wide]);
    expect(await runNarrowThenWiden(30, run)).toBe(wide);
    expect(calls).toEqual([1, 30]);
  });

  it("returns an error from the first run without retrying", async () => {
    const failed = { sql: "narrow", error: "boom" };
    const { calls, run } = stubRun([failed]);
    expect(await runNarrowThenWiden(30, run)).toBe(failed);
    expect(calls).toEqual([1]);
  });

  it("doesn't retry when the org window is 1 day", async () => {
    const { calls, run } = stubRun([empty]);
    expect(await runNarrowThenWiden(1, run)).toBe(empty);
    expect(calls).toEqual([1]);
  });
});
