import { DataSourceInterface } from "shared/types/datasource";
import { ReqContextClass } from "back-end/src/services/context";
import { waitForIndexes } from "back-end/src/models/BaseModel";
import { getDataSourcesByIds } from "back-end/src/models/DataSourceModel";
import { getExposureQueriesForDatasource } from "back-end/src/services/assignmentQuerySelection";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";

// A factory mock: @swc/jest emits non-configurable export getters, so
// jest.spyOn can't replace this.
jest.mock("back-end/src/models/DataSourceModel", () => ({
  ...jest.requireActual("back-end/src/models/DataSourceModel"),
  getDataSourcesByIds: jest.fn(),
}));
const loadByIds = jest.mocked(getDataSourcesByIds);

const datasource = {
  id: "ds_a",
  settings: {
    queries: {
      exposure: [
        {
          id: "exq_1",
          name: "Assignments",
          userIdType: "user_id",
          userIdTypes: ["user_id"],
          query: "SELECT 1",
          dimensions: [],
        },
      ],
    },
  },
} as unknown as DataSourceInterface;
const otherDatasource = {
  id: "ds_b",
  settings: { queries: { exposure: [] } },
} as unknown as DataSourceInterface;
const loadFromOrg = (_context: unknown, ids: string[]) =>
  Promise.resolve(
    [datasource, otherDatasource].filter((d) => ids.includes(d.id)),
  );

const makeContext = () =>
  new ReqContextClass({
    org: {
      id: "org",
      name: "Org",
      ownerEmail: "admin@example.com",
      url: "",
      dateCreated: new Date(),
      members: [{ id: "admin", role: "admin" }],
    },
    user: { id: "admin", email: "admin@example.com" },
    auditUser: { type: "dashboard", id: "admin", email: "admin@example.com" },
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeAll(connectTestMongo, 60000);
afterAll(async () => {
  await waitForIndexes();
  await disconnectTestMongo();
});
beforeEach(() => loadByIds.mockReset());

describe("data source foreign refs", () => {
  it("shares one load across concurrent lookups", async () => {
    const context = makeContext();
    const load = deferred<DataSourceInterface[]>();
    loadByIds.mockReturnValue(load.promise);

    const lookups = Promise.all(
      Array.from({ length: 100 }, () =>
        getExposureQueriesForDatasource(context, "ds_a"),
      ),
    );
    load.resolve([datasource]);

    const results = await lookups;
    expect(loadByIds).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r[0]?.id === "exq_1")).toBe(true);
  });

  it("fetches only the requested data sources, once each", async () => {
    const context = makeContext();
    loadByIds.mockImplementation(loadFromOrg);

    await context.populateForeignRefs({ datasource: ["ds_a", "ds_b", "ds_a"] });
    await getExposureQueriesForDatasource(context, "ds_a");
    await getExposureQueriesForDatasource(context, "ds_b");
    expect(loadByIds).toHaveBeenCalledTimes(1);
    expect(loadByIds).toHaveBeenCalledWith(context, ["ds_a", "ds_b"]);
  });

  it("doesn't refetch an id the org doesn't have", async () => {
    const context = makeContext();
    loadByIds.mockImplementation(loadFromOrg);

    for (let i = 0; i < 5; i++) {
      expect(await getExposureQueriesForDatasource(context, "ds_gone")).toEqual(
        [],
      );
    }
    expect(loadByIds).toHaveBeenCalledTimes(1);
  });

  it("rejects everyone sharing a failed load, then retries", async () => {
    const context = makeContext();
    const load = deferred<DataSourceInterface[]>();
    loadByIds.mockReturnValueOnce(load.promise);

    const lookups = Promise.allSettled(
      Array.from({ length: 3 }, () =>
        getExposureQueriesForDatasource(context, "ds_a"),
      ),
    );
    load.reject(new Error("boom"));
    const settled = await lookups;
    expect(settled.every((s) => s.status === "rejected")).toBe(true);
    expect(loadByIds).toHaveBeenCalledTimes(1);

    loadByIds.mockResolvedValueOnce([datasource]);
    expect(
      (await getExposureQueriesForDatasource(context, "ds_a"))[0]?.id,
    ).toBe("exq_1");
    expect(loadByIds).toHaveBeenCalledTimes(2);
  });

  it("reloads after the cache is forgotten", async () => {
    const context = makeContext();
    loadByIds.mockResolvedValue([datasource]);

    await getExposureQueriesForDatasource(context, "ds_a");
    context.forgetDataSourceRefs();
    await getExposureQueriesForDatasource(context, "ds_a");
    expect(loadByIds).toHaveBeenCalledTimes(2);
  });

  it("doesn't cache a load that a forget overtook", async () => {
    const context = makeContext();
    loadByIds.mockImplementationOnce(() => {
      // A data source write lands while the load is in flight.
      context.forgetDataSourceRefs();
      return Promise.resolve([datasource]);
    });

    await getExposureQueriesForDatasource(context, "ds_a");
    expect(context.foreignRefs.datasource.has("ds_a")).toBe(false);

    loadByIds.mockImplementation(loadFromOrg);
    expect(
      (await getExposureQueriesForDatasource(context, "ds_a"))[0]?.id,
    ).toBe("exq_1");
    expect(loadByIds).toHaveBeenCalledTimes(2);
  });
});
