import { DataSourceInterface } from "shared/types/datasource";
import { validateCreateSafeRolloutFields } from "back-end/src/validators/safe-rollout";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));
jest.mock("back-end/src/models/MetricModel", () => ({
  getMetricMap: jest.fn(),
}));

const context = {} as ReqContext;
const fields = {
  datasourceId: "ds_1",
  guardrailMetricIds: ["met_1"],
  maxDuration: { amount: 7, unit: "days" as const },
  autoRollback: true,
};
const stored = {
  datasourceId: "ds_1",
  exposureQueryId: "eq_single",
  exposureQueryIdentifierType: "company_id",
};

beforeEach(() => {
  jest.mocked(getDataSourceById).mockResolvedValue({
    id: "ds_1",
    settings: {
      queries: {
        exposure: [
          {
            id: "eq_single",
            name: "Single",
            userIdType: "user_id",
            userIdTypes: ["user_id"],
          },
          {
            id: "eq_multi",
            name: "Multi",
            userIdType: "anonymous_id",
            userIdTypes: ["user_id", "anonymous_id"],
          },
        ],
      },
    },
  } as unknown as DataSourceInterface);
  jest
    .mocked(getMetricMap)
    .mockResolvedValue(
      new Map([["met_1", { datasource: "ds_1" }]]) as unknown as Awaited<
        ReturnType<typeof getMetricMap>
      >,
    );
});

describe("validateCreateSafeRolloutFields", () => {
  it("stores the query's first identifier when creating without one", async () => {
    const validated = await validateCreateSafeRolloutFields(
      { ...fields, exposureQueryId: "eq_multi" },
      context,
    );
    expect(validated.exposureQueryIdentifierType).toBe("user_id");
  });

  it("stores the new query's first identifier when switching queries without one", async () => {
    const validated = await validateCreateSafeRolloutFields(
      { ...fields, exposureQueryId: "eq_multi" },
      context,
      stored,
    );
    expect(validated.exposureQueryIdentifierType).toBe("user_id");
  });

  it("keeps an unchanged selection, even one its query no longer declares", async () => {
    const validated = await validateCreateSafeRolloutFields(
      { ...fields, exposureQueryId: "eq_single" },
      context,
      stored,
    );
    expect(validated.exposureQueryIdentifierType).toBe("company_id");
  });

  it("rejects an identifier the query doesn't declare on a changed selection", async () => {
    await expect(
      validateCreateSafeRolloutFields(
        {
          ...fields,
          exposureQueryId: "eq_multi",
          exposureQueryIdentifierType: "company_id",
        },
        context,
        stored,
      ),
    ).rejects.toThrow('doesn\'t declare the "company_id" identifier type');
  });
});
