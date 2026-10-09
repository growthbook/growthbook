import { DataSourceSettings } from "shared/types/datasource";
import { applyApiDataSourceSettings } from "back-end/src/api/data-sources/manageDataSource";

describe("applyApiDataSourceSettings", () => {
  const existing: DataSourceSettings = {
    schemaFormat: "segment",
    userIdTypes: [
      { userIdType: "user_id", description: "old", managedBy: "api" },
    ],
    queries: {
      exposure: [
        {
          id: "exq_1",
          name: "Old",
          userIdType: "user_id",
          query: "SELECT 1",
          dimensions: [],
          dimensionSlicesId: "dimslice_1",
        },
      ],
      identityJoins: [{ ids: ["user_id", "anon_id"], query: "SELECT 2" }],
    },
    maxConcurrentQueries: "5",
  };

  it("leaves settings it isn't given alone", () => {
    expect(applyApiDataSourceSettings({}, existing)).toEqual(existing);
  });

  it("maps API names and keeps unexposed fields on matching ids", () => {
    const settings = applyApiDataSourceSettings(
      {
        identifierTypes: [
          { id: "user_id", description: "new" },
          { id: "device_id" },
        ],
        assignmentQueries: [
          {
            id: "exq_1",
            name: "Renamed",
            identifierType: "user_id",
            sql: "SELECT 3",
          },
          { name: "Added", identifierType: "device_id", sql: "SELECT 4" },
        ],
        queryCacheTTLMins: 60,
      },
      existing,
    );

    expect(settings.userIdTypes).toEqual([
      { userIdType: "user_id", description: "new", managedBy: "api" },
      { userIdType: "device_id", description: undefined },
    ]);
    expect(settings.queries?.exposure?.[0]).toMatchObject({
      id: "exq_1",
      name: "Renamed",
      query: "SELECT 3",
      dimensionSlicesId: "dimslice_1",
    });
    expect(settings.queries?.exposure?.[1]).toMatchObject({
      id: "",
      name: "Added",
      userIdType: "device_id",
      dimensions: [],
    });
    expect(settings.queries?.identityJoins).toEqual(
      existing.queries?.identityJoins,
    );
    expect(settings.queryCacheTTLMins).toBe("60");
    expect(settings.maxConcurrentQueries).toBe("5");
  });
});
