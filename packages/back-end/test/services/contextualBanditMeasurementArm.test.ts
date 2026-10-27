import { ContextualBanditInterface } from "shared/validators";
import {
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
