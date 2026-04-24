import { assertExperimentPayloadCommercialFeatures } from "back-end/src/api/experiments/validations";
import type { ApiReqContext } from "back-end/types/api";
function mockContext(allowed: Set<string>): ApiReqContext {
  return {
    hasPremiumFeature: (feature) => allowed.has(feature),
  } as ApiReqContext;
}
describe("assertExperimentPayloadCommercialFeatures", () => {
  it("does not require features when optional fields are absent", () => {
    const ctx = mockContext(new Set());
    expect(() =>
      assertExperimentPayloadCommercialFeatures(ctx, {}),
    ).not.toThrow();
  });
  it("allows empty decisionFrameworkSettings without decision-framework", () => {
    const ctx = mockContext(new Set());
    expect(() =>
      assertExperimentPayloadCommercialFeatures(ctx, {
        decisionFrameworkSettings: {},
      }),
    ).not.toThrow();
  });
  it("requires override-metrics when metricOverrides is present", () => {
    const ctx = mockContext(new Set());
    expect(() =>
      assertExperimentPayloadCommercialFeatures(ctx, { metricOverrides: [] }),
    ).toThrow("metricOverrides requires a higher tier plan.");
  });
  it("allows metric overrides when the feature is enabled", () => {
    const ctx = mockContext(new Set(["override-metrics"]));
    expect(() =>
      assertExperimentPayloadCommercialFeatures(ctx, {
        metricOverrides: [{ regressionAdjustmentDays: 7 }],
      }),
    ).not.toThrow();
  });
});
