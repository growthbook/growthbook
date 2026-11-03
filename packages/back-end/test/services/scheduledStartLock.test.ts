import { Changeset, ExperimentInterface } from "shared/types/experiment";
import {
  assertScheduledStartAllowsChange,
  scheduledStartLockedFields,
} from "back-end/src/services/experimentChanges/scheduledStartLock";

const phase = {
  dateStarted: new Date("2026-10-01"),
  name: "Main",
  reason: "",
  coverage: 1,
  condition: "",
  savedGroups: [],
  namespace: { enabled: false, name: "", range: [0, 1] as [number, number] },
  variationWeights: [0.5, 0.5],
  variations: [],
};

const experiment = (armed: boolean) =>
  ({
    status: "draft",
    trackingKey: "checkout",
    hashAttribute: "id",
    hashVersion: 2,
    variations: [
      { id: "v0", key: "0", name: "Control", screenshots: [] },
      { id: "v1", key: "1", name: "Variation", screenshots: [] },
    ],
    phases: [phase],
    nextScheduledStatusUpdate: armed
      ? { type: "start", date: new Date("2026-10-27") }
      : null,
  }) as unknown as ExperimentInterface;

const withPhase = (patch: object): Changeset => ({
  phases: [{ ...phase, ...patch }],
});

describe("scheduledStartLockedFields", () => {
  it.each([
    {
      name: "targeting, coverage and the split",
      changes: withPhase({
        condition: '{"country":"US"}',
        coverage: 0.5,
        variationWeights: [0.3, 0.7],
      }),
      expected: ["condition", "coverage", "variationWeights"],
    },
    {
      name: "a namespace turned on",
      changes: withPhase({
        namespace: { enabled: true, name: "ns", range: [0, 0.5] },
      }),
      expected: ["namespace"],
    },
    {
      name: "a phase added",
      changes: { phases: [phase, phase] },
      expected: ["phases"],
    },
    {
      name: "a variation key",
      changes: {
        variations: experiment(true).variations.map((v, i) =>
          i ? { ...v, key: "b" } : v,
        ),
      },
      expected: ["variations"],
    },
    {
      name: "the tracking key, which seeds hashing without a phase seed",
      changes: { trackingKey: "checkout-v2" },
      expected: ["trackingKey"],
    },
    {
      name: "the hash attribute and the holdout",
      changes: { hashAttribute: "deviceId", holdoutId: "hld_1" },
      expected: ["hashAttribute", "holdoutId"],
    },
  ])("catches $name", ({ changes, expected }) => {
    expect(scheduledStartLockedFields(experiment(true), changes)).toEqual(
      expected,
    );
  });

  it.each([
    {
      name: "variation names",
      changes: {
        variations: experiment(true).variations.map((v) => ({
          ...v,
          name: `${v.name}!`,
        })),
      },
    },
    { name: "metadata", changes: { name: "Renamed", description: "Why" } },
    {
      name: "a phase's dates",
      changes: withPhase({ dateStarted: new Date("2026-10-27") }),
    },
    {
      name: "empty values written as other empty values",
      changes: withPhase({
        condition: "{}",
        savedGroups: undefined,
        namespace: undefined,
      }),
    },
  ])("lets $name through", ({ changes }) => {
    expect(scheduledStartLockedFields(experiment(true), changes)).toEqual([]);
  });
});

describe("assertScheduledStartAllowsChange", () => {
  const coverage = withPhase({ coverage: 0.5 });

  it.each([
    {
      name: "with no scheduled start",
      exp: experiment(false),
      changes: coverage,
    },
    {
      name: "that unschedules the start",
      exp: experiment(true),
      changes: { ...coverage, nextScheduledStatusUpdate: null },
    },
    {
      name: "that starts the experiment",
      exp: experiment(true),
      changes: { ...coverage, status: "running" as const },
    },
  ])("allows a launch change $name", ({ exp, changes }) => {
    expect(() => assertScheduledStartAllowsChange(exp, changes)).not.toThrow();
  });
});
