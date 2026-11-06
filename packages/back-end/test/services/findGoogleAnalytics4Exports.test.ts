import { DataSourceInterface } from "shared/types/datasource";
import BigQuery from "back-end/src/integrations/BigQuery";
import { findGoogleAnalytics4Exports } from "back-end/src/services/datasource";
import { ReqContext } from "back-end/types/request";

const context = {} as ReqContext;

function datasource(type: "bigquery" | "postgres"): DataSourceInterface {
  return {
    id: "ds_1",
    name: "Warehouse",
    description: "",
    organization: "org_1",
    type,
    params: "",
    settings: {},
    projects: [],
    dateCreated: null,
    dateUpdated: null,
  } as DataSourceInterface;
}

describe("findGoogleAnalytics4Exports", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the exports BigQuery finds", async () => {
    jest
      .spyOn(BigQuery.prototype, "listGoogleAnalytics4Exports")
      .mockResolvedValue(["`proj.analytics_1.events_*`"]);
    await expect(
      findGoogleAnalytics4Exports(context, datasource("bigquery")),
    ).resolves.toEqual(["`proj.analytics_1.events_*`"]);
  });

  it("returns nothing instead of throwing when the lookup fails", async () => {
    jest
      .spyOn(BigQuery.prototype, "listGoogleAnalytics4Exports")
      .mockRejectedValue(new Error("Access Denied"));
    await expect(
      findGoogleAnalytics4Exports(context, datasource("bigquery")),
    ).resolves.toEqual([]);
  });

  it("gives up after five seconds", async () => {
    jest.useFakeTimers();
    try {
      jest
        .spyOn(BigQuery.prototype, "listGoogleAnalytics4Exports")
        .mockReturnValue(new Promise(() => {}));
      const result = findGoogleAnalytics4Exports(
        context,
        datasource("bigquery"),
      );
      await jest.advanceTimersByTimeAsync(5000);
      await expect(result).resolves.toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("doesn't look outside BigQuery", async () => {
    const list = jest.spyOn(BigQuery.prototype, "listGoogleAnalytics4Exports");
    await expect(
      findGoogleAnalytics4Exports(context, datasource("postgres")),
    ).resolves.toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });
});
