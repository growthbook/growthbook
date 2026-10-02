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
          {
            id: "eq_dropped",
            name: "Dropped",
            userIdType: "user_id",
            userIdTypes: ["anonymous_id"],
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
  it("keeps an unchanged selection, even one its query no longer declares", async () => {
    const validated = await validateCreateSafeRolloutFields(
      { ...fields, exposureQueryId: "eq_single" },
      context,
      stored,
    );
    expect(validated.exposureQueryIdentifierType).toBe("company_id");
  });

  it("leaves a legacy rollout's identifier unset when the form echoes the resolved one", async () => {
    const validated = await validateCreateSafeRolloutFields(
      {
        ...fields,
        exposureQueryId: "eq_multi",
        exposureQueryIdentifierType: "anonymous_id",
      },
      context,
      { datasourceId: "ds_1", exposureQueryId: "eq_multi" },
    );
    expect(validated.exposureQueryIdentifierType).toBeUndefined();
  });

  it("clears the stored identifier when switching to an implicit query", async () => {
    const validated = await validateCreateSafeRolloutFields(
      { ...fields, exposureQueryId: "eq_multi" },
      context,
      stored,
    );
    expect(validated).toHaveProperty("exposureQueryIdentifierType", undefined);
  });

  it("rejects switching to a query that dropped its legacy identifier", async () => {
    await expect(
      validateCreateSafeRolloutFields(
        { ...fields, exposureQueryId: "eq_dropped" },
        context,
        stored,
      ),
    ).rejects.toThrow(
      'no longer declares its default identifier type "user_id"',
    );
  });

  it("requires the grouped field to name an identifier on an ambiguous query", async () => {
    await expect(
      validateCreateSafeRolloutFields(
        { ...fields, exposureQueryId: "eq_multi" },
        context,
        null,
        "requireUnambiguous",
      ),
    ).rejects.toThrow("Set exposureQuery.identifierType to choose one");
  });
});
