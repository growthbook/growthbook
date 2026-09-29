import { DataSourceInterface } from "shared/types/datasource";
import {
  loadChangedAssignmentQuerySelection,
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
    ).toBeNull();
    expect(bypassRead).not.toHaveBeenCalled();
  });

  it("treats echoing a legacy record's resolved identifier as unchanged", async () => {
    const { context } = makeContext();
    expect(
      await loadChangedAssignmentQuerySelection(context, legacy, {
        ...legacy,
        identifierType: "anonymous_id",
      }),
    ).toBeNull();
  });

  it("returns the data source for a changed selection", async () => {
    const { context } = makeContext();
    expect(
      await loadChangedAssignmentQuerySelection(context, legacy, {
        ...legacy,
        identifierType: "user_id",
      }),
    ).toBe(datasource);
  });

  it("always checks a new selection", async () => {
    const { context } = makeContext();
    expect(
      await loadChangedAssignmentQuerySelection(context, null, legacy),
    ).toBe(datasource);
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
    ).toBeNull();
    expect(
      await loadChangedAssignmentQuerySelection(context, null, {
        datasource: "ds_1",
        exposureQueryId: "",
      }),
    ).toBeNull();
  });
});

describe("resolveAssignmentQueryIdentifier", () => {
  const stored = { ...legacy, identifierType: "anonymous_id" };

  it("keeps the stored identifier when re-sending the same query without one", async () => {
    const { context, bypassRead } = makeContext();
    expect(
      await resolveAssignmentQueryIdentifier(context, {
        previous: stored,
        next: legacy,
        onOmitted: "requireUnambiguous",
        field: "exposureQuery",
      }),
    ).toEqual({ identifierType: "anonymous_id", changed: false });
    expect(bypassRead).not.toHaveBeenCalled();
  });

  it("defaults a new selection without one to the query's first", async () => {
    const { context } = makeContext();
    expect(
      await resolveAssignmentQueryIdentifier(context, {
        previous: null,
        next: legacy,
        onOmitted: "defaultToFirst",
      }),
    ).toMatchObject({ identifierType: "user_id", changed: true });
  });

  it("doesn't carry the old identifier to a different query", async () => {
    const { context } = makeContext();
    await expect(
      resolveAssignmentQueryIdentifier(context, {
        previous: { ...stored, exposureQueryId: "eq_old" },
        next: legacy,
        onOmitted: "defaultToFirst",
      }),
    ).resolves.toMatchObject({ identifierType: "user_id", changed: true });
  });

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
});
