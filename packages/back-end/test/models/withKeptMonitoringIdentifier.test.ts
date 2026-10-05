import { withKeptMonitoringIdentifier } from "back-end/src/models/FeatureModel";

const config = {
  datasourceId: "ds_1",
  exposureQueryId: "eq_1",
  guardrailMetricIds: ["met_1"],
};

describe("withKeptMonitoringIdentifier", () => {
  it("keeps the stored identifier when a draft re-sends the same query without one", () => {
    expect(
      withKeptMonitoringIdentifier(
        { ...config, exposureQueryIdentifierType: "user_id" },
        config,
      ).exposureQueryIdentifierType,
    ).toBe("user_id");
  });

  it("uses the draft's identifier when it names one", () => {
    expect(
      withKeptMonitoringIdentifier(
        { ...config, exposureQueryIdentifierType: "user_id" },
        { ...config, exposureQueryIdentifierType: "anonymous_id" },
      ).exposureQueryIdentifierType,
    ).toBe("anonymous_id");
  });

  it("doesn't carry the identifier to a different query", () => {
    const next = withKeptMonitoringIdentifier(
      { ...config, exposureQueryIdentifierType: "user_id" },
      { ...config, exposureQueryId: "eq_2" },
    );
    expect("exposureQueryIdentifierType" in next).toBe(false);
  });
});
