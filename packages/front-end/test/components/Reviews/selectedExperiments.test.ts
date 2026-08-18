import { describe, expect, it } from "vitest";
import {
  getDefaultSelectedExperimentIds,
  reconcileSelectedExperimentIds,
} from "@/components/Reviews/selectedExperiments";

describe("getDefaultSelectedExperimentIds", () => {
  it("leaves immediate-start experiments unchecked", () => {
    expect([...getDefaultSelectedExperimentIds([])]).toEqual([]);
  });

  it("selects scheduled experiments by default", () => {
    expect([
      ...getDefaultSelectedExperimentIds(["sched-1", "sched-2"]),
    ]).toEqual(["sched-1", "sched-2"]);
  });
});

describe("reconcileSelectedExperimentIds", () => {
  it("does not auto-select newly appearing immediate-start experiments", () => {
    const prevSelected = new Set<string>();
    const next = reconcileSelectedExperimentIds({
      prevSelected,
      currentIds: new Set(["imm-1", "sched-1"]),
      knownIds: new Set(),
      scheduledIds: new Set(["sched-1"]),
    });
    expect([...next].sort()).toEqual(["sched-1"]);
  });

  it("preserves an explicit user selection of an immediate-start experiment", () => {
    const prevSelected = new Set(["imm-1"]);
    const next = reconcileSelectedExperimentIds({
      prevSelected,
      currentIds: new Set(["imm-1", "imm-2"]),
      knownIds: new Set(["imm-1"]),
      scheduledIds: new Set(),
    });
    expect([...next]).toEqual(["imm-1"]);
  });

  it("drops experiments that vanished and keeps the same Set when unchanged", () => {
    const prevSelected = new Set(["sched-1"]);
    const unchanged = reconcileSelectedExperimentIds({
      prevSelected,
      currentIds: new Set(["sched-1"]),
      knownIds: new Set(["sched-1"]),
      scheduledIds: new Set(["sched-1"]),
    });
    expect(unchanged).toBe(prevSelected);

    const dropped = reconcileSelectedExperimentIds({
      prevSelected,
      currentIds: new Set(),
      knownIds: new Set(["sched-1"]),
      scheduledIds: new Set(),
    });
    expect([...dropped]).toEqual([]);
  });
});
