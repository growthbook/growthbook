import { describe, expect, it } from "vitest";
import {
  getDefaultSelectedExperimentIds,
  reconcileSelectedExperimentIds,
} from "@/components/Reviews/selectedExperiments";

describe("getDefaultSelectedExperimentIds", () => {
  it("leaves all experiments unchecked", () => {
    expect([...getDefaultSelectedExperimentIds()]).toEqual([]);
  });
});

describe("reconcileSelectedExperimentIds", () => {
  it("does not auto-select newly appearing experiments", () => {
    const prevSelected = new Set<string>();
    const next = reconcileSelectedExperimentIds({
      prevSelected,
      currentIds: new Set(["imm-1", "sched-1"]),
    });
    expect([...next]).toEqual([]);
    expect(next).toBe(prevSelected);
  });

  it("preserves an explicit user selection", () => {
    const prevSelected = new Set(["imm-1", "sched-1"]);
    const next = reconcileSelectedExperimentIds({
      prevSelected,
      currentIds: new Set(["imm-1", "imm-2", "sched-1", "sched-2"]),
    });
    expect([...next].sort()).toEqual(["imm-1", "sched-1"]);
  });

  it("drops experiments that vanished and keeps the same Set when unchanged", () => {
    const prevSelected = new Set(["sched-1"]);
    const unchanged = reconcileSelectedExperimentIds({
      prevSelected,
      currentIds: new Set(["sched-1"]),
    });
    expect(unchanged).toBe(prevSelected);

    const dropped = reconcileSelectedExperimentIds({
      prevSelected,
      currentIds: new Set(),
    });
    expect([...dropped]).toEqual([]);
  });
});
