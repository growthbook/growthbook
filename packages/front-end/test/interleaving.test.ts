import type { ApiInterleavingInterface } from "shared/validators";
import {
  interleavingResultToSnapshotMetrics,
  interleavingStatusIndicatorData,
} from "@/services/interleaving";

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
  });
});

describe("interleavingStatusIndicatorData", () => {
  const il = (
    overrides: Partial<ApiInterleavingInterface> = {},
  ): Parameters<typeof interleavingStatusIndicatorData>[0] => ({
    status: "running",
    archived: false,
    variations: [
      { id: "v0", key: "control", name: "Control", config: "{}" },
      { id: "v1", key: "treatment", name: "Treatment", config: "{}" },
    ],
    datasource: "ds_1",
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
