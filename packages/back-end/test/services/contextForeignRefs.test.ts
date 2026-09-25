import { DataSourceInterface } from "shared/types/datasource";
import { ReqContextClass } from "back-end/src/services/context";
import { waitForIndexes } from "back-end/src/models/BaseModel";
import { getDataSourcesByOrganization } from "back-end/src/models/DataSourceModel";
import { getExposureQueriesForDatasource } from "back-end/src/services/assignmentQuerySelection";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";

// A factory mock: @swc/jest emits non-configurable export getters, so
// jest.spyOn can't replace this.
jest.mock("back-end/src/models/DataSourceModel", () => ({
  ...jest.requireActual("back-end/src/models/DataSourceModel"),
  getDataSourcesByOrganization: jest.fn(),
}));
const loadAll = jest.mocked(getDataSourcesByOrganization);

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
beforeEach(() => loadAll.mockReset());

describe("data source foreign refs", () => {
  it("shares one load across concurrent lookups", async () => {
    const context = makeContext();
    const load = deferred<DataSourceInterface[]>();
    loadAll.mockReturnValue(load.promise);

    const lookups = Promise.all(
      Array.from({ length: 100 }, () =>
        getExposureQueriesForDatasource(context, "ds_a"),
      ),
    );
    load.resolve([datasource]);

    const results = await lookups;
    expect(loadAll).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r[0]?.id === "exq_1")).toBe(true);
  });

  it("doesn't reload for an id the org doesn't have", async () => {
    const context = makeContext();
    loadAll.mockResolvedValue([datasource]);

    await getExposureQueriesForDatasource(context, "ds_a");
    for (let i = 0; i < 5; i++) {
      expect(await getExposureQueriesForDatasource(context, "ds_gone")).toEqual(
        [],
      );
    }
    expect(loadAll).toHaveBeenCalledTimes(1);
  });

  it("rejects everyone sharing a failed load, then retries", async () => {
    const context = makeContext();
    const load = deferred<DataSourceInterface[]>();
    loadAll.mockReturnValueOnce(load.promise);

    const lookups = Promise.allSettled(
      Array.from({ length: 3 }, () =>
        getExposureQueriesForDatasource(context, "ds_a"),
      ),
    );
    load.reject(new Error("boom"));
    const settled = await lookups;
    expect(settled.every((s) => s.status === "rejected")).toBe(true);
    expect(loadAll).toHaveBeenCalledTimes(1);

    loadAll.mockResolvedValueOnce([datasource]);
    expect(
      (await getExposureQueriesForDatasource(context, "ds_a"))[0]?.id,
    ).toBe("exq_1");
    expect(loadAll).toHaveBeenCalledTimes(2);
  });

  it("reloads after the cache is forgotten", async () => {
    const context = makeContext();
    loadAll.mockResolvedValue([datasource]);

    await getExposureQueriesForDatasource(context, "ds_a");
    context.forgetDataSourceRefs();
    await getExposureQueriesForDatasource(context, "ds_a");
    expect(loadAll).toHaveBeenCalledTimes(2);
  });
});
