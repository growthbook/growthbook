import { ContextualBanditInterface } from "shared/validators";
import { ExperimentInterface } from "shared/types/experiment";
import {
  assertMeasurementArmChangeAllowed,
  assertMeasurementArmExperimentEditable,
  buildMeasurementArmSubdoc,
  measurementArmSyncFieldsChanged,
} from "back-end/src/enterprise/services/contextualBanditMeasurementArm";

describe("buildMeasurementArmSubdoc", () => {
  const existing = {
    enabled: true,
    percent: 0.1,
    experimentId: "exp-ma",
    trackingKey: "cb-key__measurement_arm",
    seed: "seed-1",
  };

  it("defaults a new arm to off at 5% when the API body omits it", () => {
    const arm = buildMeasurementArmSubdoc({ cbTrackingKey: "cb-key" });
    expect(arm).toMatchObject({
      enabled: false,
      percent: 0.05,
      trackingKey: "cb-key__measurement_arm",
    });
    expect(arm.seed).toBeTruthy();
  });

  it("enables the arm when asked, at the default percent", () => {
    expect(
      buildMeasurementArmSubdoc({ enabled: true, cbTrackingKey: "cb-key" }),
    ).toMatchObject({ enabled: true, percent: 0.05 });
  });

  it("accepts 0% when disabling and keeps the stored percent", () => {
    const arm = buildMeasurementArmSubdoc({
      enabled: false,
      percent: 0,
      existing,
      cbTrackingKey: "cb-key",
    });
    expect(arm).toMatchObject({
      enabled: false,
      percent: 0.1,
      experimentId: "exp-ma",
      seed: "seed-1",
    });
  });

  it("falls back to the default percent when disabling a brand new arm at 0%", () => {
    const arm = buildMeasurementArmSubdoc({
      enabled: false,
      percent: 0,
      cbTrackingKey: "cb-key",
    });
    expect(arm).toMatchObject({ enabled: false, percent: 0.05 });
  });

  it("rejects a below-minimum percent on an enabled arm", () => {
    expect(() =>
      buildMeasurementArmSubdoc({
        enabled: true,
        percent: 0,
        cbTrackingKey: "cb-key",
      }),
    ).toThrow(/measurement_arm_percent/);
    expect(() =>
      buildMeasurementArmSubdoc({
        percent: 0.005,
        existing,
        cbTrackingKey: "cb-key",
      }),
    ).toThrow(/measurement_arm_percent/);
  });

  it("keeps the stored tracking key unless asked to re-derive it", () => {
    expect(
      buildMeasurementArmSubdoc({ existing, cbTrackingKey: "renamed" })
        .trackingKey,
    ).toBe("cb-key__measurement_arm");
    expect(
      buildMeasurementArmSubdoc({
        existing,
        cbTrackingKey: "renamed",
        rederiveTrackingKey: true,
      }).trackingKey,
    ).toBe("renamed__measurement_arm");
  });
});

describe("assertMeasurementArmChangeAllowed", () => {
  const arm = { enabled: true, percent: 0.1, seed: "s" };
  const draft = {
    status: "draft",
    measurementArm: arm,
  } as unknown as ContextualBanditInterface;
  const running = {
    ...draft,
    status: "running",
  } as unknown as ContextualBanditInterface;

  it("allows changes while the CB is a draft", () => {
    expect(() =>
      assertMeasurementArmChangeAllowed(draft, {
        measurementArm: { ...arm, percent: 0.2 },
      }),
    ).not.toThrow();
  });

  it("locks enabled and percent once the CB has started", () => {
    expect(() =>
      assertMeasurementArmChangeAllowed(running, {
        measurementArm: { ...arm, percent: 0.2 },
      }),
    ).toThrow(/measurement_arm_locked/);
    expect(() =>
      assertMeasurementArmChangeAllowed(running, {
        measurementArm: { ...arm, enabled: false },
      }),
    ).toThrow(/measurement_arm_locked/);
  });

  it("ignores writes that keep enabled and percent as they are", () => {
    expect(() =>
      assertMeasurementArmChangeAllowed(running, {
        measurementArm: { ...arm, trackingKey: "renamed__measurement_arm" },
      }),
    ).not.toThrow();
    expect(() => assertMeasurementArmChangeAllowed(running, {})).not.toThrow();
  });
});

describe("assertMeasurementArmExperimentEditable", () => {
  const experiment = {
    type: "contextualBanditMeasurementArm",
    name: "CB — measurement arm",
    goalMetrics: ["met_g"],
    secondaryMetrics: [],
    guardrailMetrics: [],
    phases: [{ dateStarted: new Date("2026-01-01") }],
  } as unknown as ExperimentInterface;

  it("allows secondary and guardrail metric changes", () => {
    expect(() =>
      assertMeasurementArmExperimentEditable(experiment, {
        secondaryMetrics: ["met_s"],
        guardrailMetrics: ["met_gr"],
      }),
    ).not.toThrow();
  });

  it("rejects a CUPED toggle", () => {
    expect(() =>
      assertMeasurementArmExperimentEditable(experiment, {
        regressionAdjustmentEnabled: true,
      }),
    ).toThrow(/regressionAdjustmentEnabled/);
  });

  it("allows unchanged governed fields to be re-sent", () => {
    expect(() =>
      assertMeasurementArmExperimentEditable(experiment, {
        name: "CB — measurement arm",
        goalMetrics: ["met_g"],
        description: "",
      }),
    ).not.toThrow();
  });

  it("rejects changes to governed fields and phase dates", () => {
    expect(() =>
      assertMeasurementArmExperimentEditable(experiment, {
        goalMetrics: ["met_other"],
      }),
    ).toThrow(/goalMetrics/);
    expect(() =>
      assertMeasurementArmExperimentEditable(experiment, {
        phaseStartDate: "2026-02-01",
        currentPhase: 0,
      }),
    ).toThrow(/phaseStartDate/);
  });

  it("does nothing for other experiment types", () => {
    expect(() =>
      assertMeasurementArmExperimentEditable(
        { ...experiment, type: "standard" } as ExperimentInterface,
        { goalMetrics: ["met_other"] },
      ),
    ).not.toThrow();
  });
});

describe("measurementArmSyncFieldsChanged", () => {
  const cb = {
    id: "cb1",
    name: "CB",
    status: "running",
    coverage: 1,
    nextSnapshotAttempt: new Date("2026-01-01"),
    analysisSummary: { foo: 1 },
    dateUpdated: new Date("2026-01-01"),
  } as unknown as ContextualBanditInterface;

  it("ignores operational writes", () => {
    const next = {
      ...cb,
      nextSnapshotAttempt: new Date("2026-02-01"),
      analysisSummary: { foo: 2 },
      dateUpdated: new Date("2026-02-01"),
    } as unknown as ContextualBanditInterface;
    expect(measurementArmSyncFieldsChanged(cb, next)).toBe(false);
  });

  it("flags governed field changes", () => {
    expect(
      measurementArmSyncFieldsChanged(cb, {
        ...cb,
        status: "stopped",
      } as ContextualBanditInterface),
    ).toBe(true);
    expect(
      measurementArmSyncFieldsChanged(cb, {
        ...cb,
        coverage: 0.5,
      } as ContextualBanditInterface),
    ).toBe(true);
  });
});
