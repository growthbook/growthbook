import { beforeEach, vi } from "vitest";
import type { ApiInterleavingInterface } from "shared/validators";
import type { GrowthBook } from "@growthbook/growthbook-react";
import type { AppFeatures } from "shared/types/app-features";
import {
  interleavingResultToSnapshotMetrics,
  interleavingStatusIndicatorData,
  isInterleavingEnabled,
} from "@/services/interleaving";

const envInterleaving = vi.hoisted(() => ({ value: false }));

vi.mock("@/services/env", () => ({
  envEnablesInterleaving: () => envInterleaving.value,
}));

describe("isInterleavingEnabled", () => {
  const gbWithFlag = (on: boolean) =>
    ({ isOn: () => on }) as unknown as GrowthBook<AppFeatures>;

  beforeEach(() => {
    envInterleaving.value = false;
  });

  it("is off when neither the env var nor the remote flag is set", () => {
    expect(isInterleavingEnabled(gbWithFlag(false))).toBe(false);
  });

  it("is off when gb is absent and the env var is unset", () => {
    expect(isInterleavingEnabled(undefined)).toBe(false);
  });

  it("follows the remote flag", () => {
    expect(isInterleavingEnabled(gbWithFlag(true))).toBe(true);
  });

  it("lets the env var override a missing or off remote flag", () => {
    envInterleaving.value = true;
    expect(isInterleavingEnabled(undefined)).toBe(true);
    expect(isInterleavingEnabled(gbWithFlag(false))).toBe(true);
  });
});

describe("interleavingResultToSnapshotMetrics", () => {
  it("puts the test on treatment and widens null CI bounds", () => {
    const [control, treatment] = interleavingResultToSnapshotMetrics({
      metricId: "fact__m",
      analysis: { type: "paired" },
      users: 100,
      denominator: 250,
      control: { value: 10, cr: 0.04 },
      treatment: { value: 15, cr: 0.06 },
      test: {
        method: "paired_delta_t",
        expected: 0.05,
        ci: [0.01, null],
        pValue: null,
        errorMessage: null,
        pValueErrorMessage: "NUMERICAL_PVALUE_NOT_CONVERGED",
      },
    });
    expect(control).toEqual({
      value: 10,
      cr: 0.04,
      users: 100,
      denominator: 250,
    });
    expect(treatment.denominator).toBe(250);
    expect(treatment.ci).toEqual([0.01, Infinity]);
    expect(treatment.expected).toBe(0.05);
    expect(treatment.pValue).toBeUndefined();
    expect(treatment.errorMessage).toBeUndefined();
    expect(treatment.computeFailed).toBeUndefined();
  });

  it("reports a failed test instead of inventing bounds", () => {
    const [control, treatment] = interleavingResultToSnapshotMetrics({
      metricId: "fact__m",
      analysis: { type: "paired" },
      users: 100,
      denominator: 250,
      control: { value: 10, cr: 0.04 },
      treatment: { value: 15, cr: 0.06 },
      test: {
        method: "paired_delta_t",
        expected: 0,
        ci: [null, null],
        pValue: null,
        errorMessage: "ZERO_VARIANCE",
        pValueErrorMessage: null,
      },
    });
    // ResultsTable gates its error row on computeFailed && !users
    expect(treatment.computeFailed).toBe(true);
    expect(treatment.errorMessage).toBe("ZERO_VARIANCE");
    expect(treatment.users).toBe(0);
    expect(control.users).toBe(0);
    expect(treatment.ci).toBeUndefined();
    expect(treatment.expected).toBeUndefined();
    expect(treatment.pValue).toBeUndefined();
  });
});

describe("interleavingStatusIndicatorData", () => {
  const il = (
    overrides: Partial<ApiInterleavingInterface> = {},
  ): Parameters<typeof interleavingStatusIndicatorData>[0] => ({
    status: "running",
    archived: false,
    variations: {
      control: { id: "v0", key: "control", name: "Control", config: "{}" },
      treatment: {
        id: "v1",
        key: "treatment",
        name: "Treatment",
        config: "{}",
      },
    },
    datasourceId: "ds_1",
    coverage: 0.5,
    condition: '{"country":"US"}',
    seed: "seed_1",
    dateCreated: "2026-01-01T00:00:00.000Z",
    dateStarted: "2026-01-02T00:00:00.000Z",
    dateStopped: undefined,
    ...overrides,
  });

  it("maps onto the experiment status shape the shared badge reads", () => {
    const data = interleavingStatusIndicatorData(il());
    expect(data.type).toBe("interleaving");
    expect(data.status).toBe("running");
    expect(data.archived).toBe(false);
    expect(data.variations).toEqual([{ id: "v0" }, { id: "v1" }]);
    // No decision framework, so nothing should imply a result.
    expect(data.results).toBeUndefined();
    expect(data.goalMetrics).toEqual([]);
  });

  it("carries status and archived through", () => {
    expect(
      interleavingStatusIndicatorData(il({ status: "draft" })).status,
    ).toBe("draft");
    expect(
      interleavingStatusIndicatorData(il({ archived: true })).archived,
    ).toBe(true);
  });

  it("uses the start date for the phase, falling back to creation", () => {
    const started = interleavingStatusIndicatorData(il());
    expect(started.phases?.[0]?.dateStarted).toBe("2026-01-02T00:00:00.000Z");

    const neverStarted = interleavingStatusIndicatorData(
      il({ status: "draft", dateStarted: undefined }),
    );
    expect(neverStarted.phases?.[0]?.dateStarted).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("reports the stop date as the phase end", () => {
    const stopped = interleavingStatusIndicatorData(
      il({ status: "stopped", dateStopped: "2026-01-09T00:00:00.000Z" }),
    );
    expect(stopped.phases?.[0]?.dateEnded).toBe("2026-01-09T00:00:00.000Z");
  });

  it("defaults coverage to full when unset", () => {
    const data = interleavingStatusIndicatorData(il({ coverage: undefined }));
    expect(data.phases?.[0]?.coverage).toBe(1);
  });
});
