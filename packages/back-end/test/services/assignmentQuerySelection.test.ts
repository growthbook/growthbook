import { DataSourceInterface } from "shared/types/datasource";
import {
  loadChangedAssignmentQuerySelection,
  resolveApiMonitoringConfig,
  resolveAssignmentQueryIdentifier,
} from "back-end/src/services/assignmentQuerySelection";
import { ReqContext } from "back-end/types/request";

const datasource = {
  id: "ds_1",
  settings: {
    queries: {
      exposure: [
        {
          id: "eq_1",
          name: "Assignments",
          userIdType: "anonymous_id",
          userIdTypes: ["user_id", "anonymous_id"],
          query: "SELECT 1",
          dimensions: [],
        },
        {
          id: "eq_2",
          name: "Users",
          userIdType: "user_id",
          userIdTypes: ["user_id"],
          query: "SELECT 1",
          dimensions: [],
        },
        {
          id: "eq_dropped",
          name: "Dropped",
          userIdType: "user_id",
          userIdTypes: ["anonymous_id"],
          query: "SELECT 1",
          dimensions: [],
        },
      ],
    },
  },
} as unknown as DataSourceInterface;

function makeContext(cached: DataSourceInterface[] = []) {
  const bypassRead = jest.fn(async (id: string) =>
    id === datasource.id ? datasource : null,
  );
  const context = {
    foreignRefs: { datasource: new Map(cached.map((ds) => [ds.id, ds])) },
    dangerouslyGetDataSourceByIdBypassPermission: bypassRead,
  } as unknown as ReqContext;
  return { context, bypassRead };
}

const legacy = { datasource: "ds_1", exposureQueryId: "eq_1" };

describe("loadChangedAssignmentQuerySelection", () => {
  it("skips the read for an identical selection", async () => {
    const { context, bypassRead } = makeContext();
    expect(
      await loadChangedAssignmentQuerySelection(context, legacy, legacy),
    ).toEqual({ changed: false });
    expect(bypassRead).not.toHaveBeenCalled();
  });

  it("treats echoing a legacy record's resolved identifier as unchanged", async () => {
    const { context } = makeContext();
    expect(
      await loadChangedAssignmentQuerySelection(context, legacy, {
        ...legacy,
        identifierType: "anonymous_id",
      }),
    ).toEqual({ changed: false });
  });

  it("returns the data source for a changed selection", async () => {
    const { context } = makeContext();
    expect(
      await loadChangedAssignmentQuerySelection(context, legacy, {
        ...legacy,
        identifierType: "user_id",
      }),
    ).toEqual({ changed: true, datasource });
  });

  it("always checks a new selection", async () => {
    const { context } = makeContext();
    expect(
      await loadChangedAssignmentQuerySelection(context, null, legacy),
    ).toEqual({ changed: true, datasource });
  });

  it("uses the request's cached data source before bypassing read scope", async () => {
    const { context, bypassRead } = makeContext([datasource]);
    await loadChangedAssignmentQuerySelection(context, null, legacy);
    expect(bypassRead).not.toHaveBeenCalled();
  });

  it("leaves a missing data source or query id to analysis", async () => {
    const { context } = makeContext();
    expect(
      await loadChangedAssignmentQuerySelection(context, null, {
        datasource: "ds_gone",
        exposureQueryId: "eq_1",
      }),
    ).toEqual({ changed: true, datasource: null });
    expect(
      await loadChangedAssignmentQuerySelection(context, null, {
        datasource: "ds_1",
        exposureQueryId: "",
      }),
    ).toEqual({ changed: true, datasource: null });
  });
});

describe("resolveAssignmentQueryIdentifier", () => {
  it("requires the grouped field to name one on an ambiguous query", async () => {
    const { context } = makeContext();
    await expect(
      resolveAssignmentQueryIdentifier(context, {
        previous: null,
        next: legacy,
        onOmitted: "requireUnambiguous",
        field: "exposureQuery",
      }),
    ).rejects.toThrow("Set exposureQuery.identifierType to choose one");
  });

  it("passes the kept identifier through when there's no data source to check", async () => {
    const { context } = makeContext();
    expect(
      await resolveAssignmentQueryIdentifier(context, {
        previous: null,
        next: { ...legacy, datasource: "ds_gone", identifierType: "user_id" },
        onOmitted: "defaultToFirst",
      }),
    ).toEqual({ identifierType: "user_id", changed: false });
  });

  it("leaves a new selection implicit when the query declares its legacy identifier", async () => {
    const { context } = makeContext();
    expect(
      await resolveAssignmentQueryIdentifier(context, {
        previous: null,
        next: legacy,
        onOmitted: "defaultToFirst",
      }),
    ).toMatchObject({ identifierType: undefined, changed: true });
  });

  it("drops the stored identifier when switching queries without naming one", async () => {
    const { context } = makeContext();
    const pinned = { ...legacy, identifierType: "user_id" };
    expect(
      await resolveAssignmentQueryIdentifier(context, {
        previous: pinned,
        next: { datasource: "ds_1", exposureQueryId: "eq_2" },
        onOmitted: "defaultToFirst",
      }),
    ).toMatchObject({ identifierType: undefined, changed: true });
    await expect(
      resolveAssignmentQueryIdentifier(context, {
        previous: pinned,
        next: { datasource: "ds_1", exposureQueryId: "eq_dropped" },
        onOmitted: "defaultToFirst",
      }),
    ).rejects.toThrow(
      'no longer declares its default identifier type "user_id"',
    );
  });

  it("keeps a legacy record implicit when the update echoes its resolved identifier", async () => {
    const { context } = makeContext();
    expect(
      await resolveAssignmentQueryIdentifier(context, {
        previous: legacy,
        next: { ...legacy, identifierType: "anonymous_id" },
        onOmitted: "defaultToFirst",
      }),
    ).toEqual({ identifierType: undefined, changed: false });
  });
});

describe("resolveApiMonitoringConfig", () => {
  const config = {
    datasourceId: "ds_1",
    guardrailMetricIds: ["met_1"],
  };

  it("leaves the identifier out when switching to an implicit query", async () => {
    const { context } = makeContext();
    const resolved = await resolveApiMonitoringConfig(
      context,
      { ...config, exposureQueryId: "eq_2" },
      {
        ...config,
        exposureQueryId: "eq_1",
        exposureQueryIdentifierType: "user_id",
      },
    );
    expect(resolved).toEqual({ ...config, exposureQueryId: "eq_2" });
  });

  it("keeps an implicit config implicit when the body echoes its resolved identifier", async () => {
    const { context } = makeContext();
    const resolved = await resolveApiMonitoringConfig(
      context,
      {
        ...config,
        exposureQuery: { id: "eq_1", identifierType: "anonymous_id" },
      },
      { ...config, exposureQueryId: "eq_1" },
    );
    expect(resolved).toEqual({ ...config, exposureQueryId: "eq_1" });
  });

  it("rejects a new config on a query that dropped its legacy identifier", async () => {
    const { context } = makeContext();
    await expect(
      resolveApiMonitoringConfig(
        context,
        { ...config, exposureQueryId: "eq_dropped" },
        null,
      ),
    ).rejects.toThrow(
      'no longer declares its default identifier type "user_id". Set exposureQuery.identifierType to choose one.',
    );
  });
});
