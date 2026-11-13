import { getExposureQueryProjects } from "shared/util";
import {
  DataSourceInterface,
  DataSourceSettings,
  ExposureQuery,
} from "shared/types/datasource";
import { applyApiDataSourceSettings } from "back-end/src/api/data-sources/manageDataSource";
import {
  assertCanUpdateDataSource,
  withSavedUnreadableExposureQueries,
} from "back-end/src/services/datasourceChanges";
import { withReadableExposureQueries } from "back-end/src/services/datasourceResponse";
import { ApiReqContext } from "back-end/types/api";

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

  it("merges a partial pipeline edit, but needs whole new settings", () => {
    const merged = applyApiDataSourceSettings(
      { pipelineSettings: { unitsTableRetentionHours: 48 } },
      {
        pipelineSettings: {
          allowWriting: true,
          mode: "ephemeral",
          writeDataset: "gb",
          unitsTableRetentionHours: 24,
        },
      },
    );
    expect(merged.pipelineSettings).toEqual({
      allowWriting: true,
      mode: "ephemeral",
      writeDataset: "gb",
      unitsTableRetentionHours: 48,
    });
    expect(() =>
      applyApiDataSourceSettings(
        { pipelineSettings: { unitsTableRetentionHours: 48 } },
        {},
      ),
    ).toThrow("pipelineSettings is missing");
    // The GET contract always has writeDataset, even when writing is off
    expect(() =>
      applyApiDataSourceSettings(
        {
          pipelineSettings: {
            allowWriting: false,
            mode: "ephemeral",
            unitsTableRetentionHours: 24,
          },
        },
        {},
      ),
    ).toThrow("pipelineSettings is missing writeDataset");
    expect(() =>
      applyApiDataSourceSettings(
        { pipelineSettings: { mode: "incremental" } },
        {
          pipelineSettings: {
            allowWriting: true,
            mode: "ephemeral",
            writeDataset: "",
            unitsTableRetentionHours: 24,
          },
        },
      ),
    ).toThrow("pipelineSettings is missing writeDataset");
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

describe("REST update with assignment queries the user can't read", () => {
  const query = (id: string, projects: string[]): ExposureQuery => ({
    id,
    name: id,
    userIdType: "user_id",
    userIdTypes: ["user_id"],
    query: `SELECT '${id}'`,
    dimensions: [],
    projects,
  });
  const visible = query("exq_a", ["prj_a"]);
  const hidden = query("exq_b", ["prj_b"]);
  const datasource = {
    id: "ds_1",
    projects: ["prj_a", "prj_b"],
    settings: { queries: { exposure: [visible, hidden] } },
  } as DataSourceInterface;
  // A member of prj_a only
  const context = {
    permissions: {
      canReadMultiProjectResource: (projects: string[]) =>
        !projects.length || projects.includes("prj_a"),
      canUpdateDataSourceSettings: () => false,
      canUpdateExposureQuery: (
        q: Pick<ExposureQuery, "projects">,
        ds: Pick<DataSourceInterface, "projects">,
      ) => {
        const projects = getExposureQueryProjects(q, ds.projects);
        return projects.length > 0 && projects.every((p) => p === "prj_a");
      },
      throwPermissionError: () => {
        throw new Error("Forbidden");
      },
    },
  } as unknown as ApiReqContext;

  // What the REST handler hands to updateDataSourceWithChecks, and what that
  // checks and saves
  const save = (input: Parameters<typeof applyApiDataSourceSettings>[0]) => {
    const settings = withSavedUnreadableExposureQueries(
      context,
      datasource,
      applyApiDataSourceSettings(
        input,
        withReadableExposureQueries(context, datasource),
      ),
    );
    assertCanUpdateDataSource(context, datasource, { settings });
    return settings;
  };

  it("keeps hidden queries when what GET showed is sent back", () => {
    const settings = save({
      assignmentQueries: [{ id: "exq_a", name: "exq_a", sql: visible.query }],
    });
    expect(settings?.queries?.exposure).toEqual([visible, hidden]);
  });

  it("keeps hidden queries when a visible one is edited", () => {
    const settings = save({
      assignmentQueries: [{ id: "exq_a", name: "Renamed", sql: "SELECT 2" }],
    });
    expect(settings?.queries?.exposure).toEqual([
      { ...visible, name: "Renamed", query: "SELECT 2" },
      hidden,
    ]);
  });

  it("refuses a write that reuses a hidden query's id", () => {
    expect(() =>
      save({
        assignmentQueries: [
          { id: "exq_a", name: "exq_a", sql: visible.query },
          {
            id: "exq_b",
            name: "Taken",
            sql: "SELECT 9",
            identifierType: "user_id",
            projects: ["prj_a"],
          },
        ],
      }),
    ).toThrow("Forbidden");
  });

  it("restores hidden queries when assignment queries aren't sent", () => {
    const settings = withSavedUnreadableExposureQueries(
      context,
      datasource,
      applyApiDataSourceSettings(
        { queryCacheTTLMins: 5 },
        withReadableExposureQueries(context, datasource),
      ),
    );
    expect(settings?.queries?.exposure).toEqual([visible, hidden]);
  });
});
