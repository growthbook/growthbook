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
          userIdTypes: ["user_id"],
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
            identifierTypes: ["anon_id", "user_id"],
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
      userIdType: "user_id",
      userIdTypes: ["anon_id", "user_id"],
      dimensionSlicesId: "dimslice_1",
    });
    expect(settings.queries?.exposure?.[1]).toMatchObject({
      id: "",
      name: "Added",
      userIdType: "device_id",
      userIdTypes: ["device_id"],
      dimensions: [],
    });
    expect(settings.queries?.identityJoins).toEqual(
      existing.queries?.identityJoins,
    );
    expect(settings.queryCacheTTLMins).toBe("60");
    expect(settings.maxConcurrentQueries).toBe("5");
  });

  it("restores every experiment to the pipeline on a null included list", () => {
    const pipelineSettings = {
      allowWriting: true,
      mode: "incremental" as const,
      writeDataset: "gb",
      unitsTableRetentionHours: 24,
    };
    const scoped = applyApiDataSourceSettings(
      { pipelineSettings },
      {
        pipelineSettings: {
          ...pipelineSettings,
          includedExperimentIds: ["exp_1"],
          excludedExperimentIds: ["exp_2"],
        },
      },
    );
    expect(scoped.pipelineSettings?.includedExperimentIds).toEqual(["exp_1"]);

    const all = applyApiDataSourceSettings(
      {
        pipelineSettings: { ...pipelineSettings, includedExperimentIds: null },
      },
      scoped,
    );
    expect(all.pipelineSettings).not.toHaveProperty("includedExperimentIds");
    expect(all.pipelineSettings?.excludedExperimentIds).toEqual(["exp_2"]);
  });

  it("leaves a managed query untouched when its GET shape is posted back", () => {
    const managed: DataSourceSettings = {
      userIdTypes: [{ userIdType: "user_id", managedBy: "api" }],
      queries: {
        exposure: [
          {
            id: "exq_ef",
            name: "Event Forwarder",
            userIdType: "user_id",
            userIdTypes: ["user_id"],
            query: "SELECT 1",
            dimensions: [],
            managedBy: "api",
          },
        ],
      },
    };
    const settings = applyApiDataSourceSettings(
      {
        identifierTypes: [{ id: "user_id", description: "" }],
        assignmentQueries: [
          {
            id: "exq_ef",
            name: "Event Forwarder",
            description: "",
            identifierTypes: ["user_id"],
            identifierType: "user_id",
            sql: "SELECT 1",
            includesNameColumns: false,
            dimensionColumns: [],
          },
        ],
      },
      managed,
    );
    expect(settings.userIdTypes).toStrictEqual(managed.userIdTypes);
    expect(settings.queries?.exposure).toStrictEqual(managed.queries?.exposure);
  });
});
