import { apiRampMonitoringConfigInput } from "shared/validators";
import {
  apiMonitoringConfigToInternal,
  monitoringConfigToApi,
} from "shared/util";

describe("monitoring config round trip", () => {
  const stored = {
    datasourceId: "ds_1",
    exposureQueryId: "eq_1",
    guardrailMetricIds: ["met_1"],
  };
  const queries = [
    { id: "eq_1", userIdType: "anonymous_id", userIdTypes: ["anonymous_id"] },
  ];

  it("accepts a response's config sent back unchanged", () => {
    const returned = monitoringConfigToApi(
      { ...stored, exposureQueryIdentifierType: "anonymous_id" },
      queries,
    );
    const input = apiRampMonitoringConfigInput.parse(returned);
    expect(apiMonitoringConfigToInternal(input, null)).toMatchObject({
      exposureQueryId: "eq_1",
      exposureQueryIdentifierType: "anonymous_id",
    });
  });

  it("keeps the stored identifier when a null one is sent back", () => {
    const returned = monitoringConfigToApi(stored, []);
    expect(returned.exposureQuery.identifierType).toBeNull();
    const input = apiRampMonitoringConfigInput.parse(returned);
    expect(
      apiMonitoringConfigToInternal(input, {
        ...stored,
        exposureQueryIdentifierType: "anonymous_id",
      }).exposureQueryIdentifierType,
    ).toBe("anonymous_id");
  });
});
