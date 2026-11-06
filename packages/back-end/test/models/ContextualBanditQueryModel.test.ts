import { Collection } from "mongodb";
import { ContextualBanditQueryInterface } from "shared/validators";
import { buildManagedWarehouseContextualBanditQueries } from "shared/util";
import { SDKAttributeSchema } from "shared/types/organization";
import { Context } from "back-end/src/models/BaseModel";
import { ContextualBanditQueryModel } from "back-end/src/enterprise/models/ContextualBanditQueryModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const mockGetDataSourceById = jest.mocked(getDataSourceById);

type Doc = Record<string, unknown>;

function matches(doc: Doc, query: Doc): boolean {
  return Object.entries(query).every(([k, v]) => doc[k] === v);
}

class FakeCollection {
  docs: Doc[] = [];
  insertOne = jest.fn(async (doc: Doc) => {
    this.docs.push({ ...doc });
  });
  updateOne = jest.fn(async (query: Doc, update: { $set?: Doc }) => {
    const doc = this.docs.find((d) => matches(d, query));
    if (!doc) return { matchedCount: 0 };
    Object.assign(doc, update.$set ?? {});
    return { matchedCount: 1 };
  });
  deleteOne = jest.fn(async (query: Doc) => {
    this.docs = this.docs.filter((d) => !matches(d, query));
  });
  findOne = jest.fn(async (query: Doc) => {
    const doc = this.docs.find((d) => matches(d, query));
    return doc ? { ...doc } : null;
  });
  find = jest.fn((query: Doc) => {
    const results = this.docs.filter((d) => matches(d, query));
    const cursor = {
      project: () => cursor,
      sort: () => cursor,
      skip: () => cursor,
      limit: () => cursor,
      toArray: async () => results.map((d) => ({ ...d })),
    };
    return cursor;
  });
}

class TestModel extends ContextualBanditQueryModel {
  public collection = new FakeCollection();
  protected updateIndexes() {
    return Promise.resolve();
  }
  protected _dangerousGetCollection(): Collection {
    return this.collection as unknown as Collection;
  }
}

const staleSchema: SDKAttributeSchema = [
  { property: "id", datatype: "string", hashAttribute: true },
  { property: "country", datatype: "string" },
];
const freshSchema: SDKAttributeSchema = [
  ...staleSchema,
  { property: "browser", datatype: "string" },
];

function makeContext({
  premium = true,
  canEditDatasource = true,
  referencingBandits = [] as { id: string; name: string }[],
} = {}) {
  const getByContextualBanditQueryId = jest.fn(async () => referencingBandits);
  const context = {
    org: { id: "org_1", settings: { attributeSchema: staleSchema } },
    userId: "u_1",
    hasPremiumFeature: () => premium,
    permissions: {
      canUpdateDataSourceSettings: () => canEditDatasource,
      throwPermissionError: () => {
        throw new Error("permission denied");
      },
    },
    throwNotFoundError: (msg: string) => {
      throw new Error(msg);
    },
    models: {
      contextualBandits: { getByContextualBanditQueryId },
    },
    registerTags: jest.fn(),
    populateForeignRefs: jest.fn(),
  } as unknown as Context;
  return { context, getByContextualBanditQueryId };
}

function makeCustomQuery(
  overrides: Partial<ContextualBanditQueryInterface> = {},
): ContextualBanditQueryInterface {
  return {
    id: "cbq_custom",
    organization: "org_1",
    dateCreated: new Date("2026-01-01"),
    dateUpdated: new Date("2026-01-01"),
    owner: "",
    datasourceId: "ds_mw",
    name: "My query",
    userIdType: "user_id",
    query: "SELECT * FROM experiment_views",
    targetingAttributeColumns: ["country"],
    ...overrides,
  };
}

describe("ContextualBanditQueryModel managed warehouse sync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDataSourceById.mockResolvedValue({
      id: "ds_mw",
      type: "growthbook_clickhouse",
    } as never);
  });

  it("creates one managed query per identifier, validated against the passed schema", async () => {
    const { context } = makeContext();
    const model = new TestModel(context);
    const desired = buildManagedWarehouseContextualBanditQueries(freshSchema);

    await model.dangerouslySyncManagedWarehouseQueries(
      "ds_mw",
      desired,
      freshSchema,
    );

    const docs = model.collection.docs;
    expect(docs.map((d) => d.userIdType)).toEqual(["user_id", "device_id"]);
    docs.forEach((d, i) => {
      expect(d.managedBy).toBe("api");
      expect(d.organization).toBe("org_1");
      expect(d.datasourceId).toBe("ds_mw");
      expect(d.name).toBe(desired[i].name);
      expect(d.query).toBe(desired[i].query);
      expect(d.targetingAttributeColumns).toEqual(["browser", "country"]);
    });
  });

  it("works for non-premium orgs and actors without datasource permission", async () => {
    const { context } = makeContext({
      premium: false,
      canEditDatasource: false,
    });
    const model = new TestModel(context);

    await model.dangerouslySyncManagedWarehouseQueries(
      "ds_mw",
      buildManagedWarehouseContextualBanditQueries(staleSchema),
      staleSchema,
    );

    expect(model.collection.docs).toHaveLength(2);
  });

  it("updates existing managed queries in place and skips unchanged ones", async () => {
    const { context } = makeContext();
    const model = new TestModel(context);
    await model.dangerouslySyncManagedWarehouseQueries(
      "ds_mw",
      buildManagedWarehouseContextualBanditQueries(staleSchema),
      staleSchema,
    );
    const ids = model.collection.docs.map((d) => d.id);
    model.collection.updateOne.mockClear();
    model.collection.insertOne.mockClear();

    await model.dangerouslySyncManagedWarehouseQueries(
      "ds_mw",
      buildManagedWarehouseContextualBanditQueries(staleSchema),
      staleSchema,
    );
    expect(model.collection.updateOne).not.toHaveBeenCalled();
    expect(model.collection.insertOne).not.toHaveBeenCalled();

    await model.dangerouslySyncManagedWarehouseQueries(
      "ds_mw",
      buildManagedWarehouseContextualBanditQueries(freshSchema),
      freshSchema,
    );
    expect(model.collection.insertOne).not.toHaveBeenCalled();
    expect(model.collection.updateOne).toHaveBeenCalledTimes(2);
    expect(model.collection.docs.map((d) => d.id)).toEqual(ids);
    model.collection.docs.forEach((d) => {
      expect(d.targetingAttributeColumns).toEqual(["browser", "country"]);
    });
  });

  it("deletes managed queries for removed identifiers unless a bandit still uses them", async () => {
    const withCustomIdentifier: SDKAttributeSchema = [
      ...staleSchema,
      { property: "company_id", datatype: "string", hashAttribute: true },
    ];
    const { context, getByContextualBanditQueryId } = makeContext();
    const model = new TestModel(context);
    await model.dangerouslySyncManagedWarehouseQueries(
      "ds_mw",
      buildManagedWarehouseContextualBanditQueries(withCustomIdentifier),
      withCustomIdentifier,
    );
    expect(model.collection.docs.map((d) => d.userIdType)).toEqual([
      "user_id",
      "device_id",
      "company_id",
    ]);

    getByContextualBanditQueryId.mockResolvedValueOnce([
      { id: "cb_1", name: "Checkout" },
    ]);
    await model.dangerouslySyncManagedWarehouseQueries(
      "ds_mw",
      buildManagedWarehouseContextualBanditQueries(staleSchema),
      staleSchema,
    );
    expect(model.collection.docs.map((d) => d.userIdType)).toEqual([
      "user_id",
      "device_id",
      "company_id",
    ]);

    await model.dangerouslySyncManagedWarehouseQueries(
      "ds_mw",
      buildManagedWarehouseContextualBanditQueries(staleSchema),
      staleSchema,
    );
    expect(model.collection.docs.map((d) => d.userIdType)).toEqual([
      "user_id",
      "device_id",
    ]);
  });

  it("leaves user-written queries on the same datasource alone", async () => {
    const { context } = makeContext();
    const model = new TestModel(context);
    model.collection.docs.push(makeCustomQuery() as unknown as Doc);

    await model.dangerouslySyncManagedWarehouseQueries(
      "ds_mw",
      buildManagedWarehouseContextualBanditQueries(staleSchema),
      staleSchema,
    );
    await model.dangerouslySyncManagedWarehouseQueries(
      "ds_mw",
      [],
      staleSchema,
    );

    expect(model.collection.docs.map((d) => d.id)).toEqual(["cbq_custom"]);
    expect(model.collection.docs[0].query).toBe(
      "SELECT * FROM experiment_views",
    );
  });

  it("removes managed queries on datasource deletion even when referenced", async () => {
    const { context } = makeContext({
      referencingBandits: [{ id: "cb_1", name: "Checkout" }],
    });
    const model = new TestModel(context);
    model.collection.docs.push(makeCustomQuery() as unknown as Doc);
    await model.dangerouslySyncManagedWarehouseQueries(
      "ds_mw",
      buildManagedWarehouseContextualBanditQueries(staleSchema),
      staleSchema,
    );

    await model.dangerouslyDeleteManagedWarehouseQueries("ds_mw");

    expect(model.collection.docs.map((d) => d.id)).toEqual(["cbq_custom"]);
  });
});

describe("ContextualBanditQueryModel managed query lock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDataSourceById.mockResolvedValue({
      id: "ds_mw",
      type: "growthbook_clickhouse",
    } as never);
  });

  async function seedManaged(model: TestModel) {
    await model.dangerouslySyncManagedWarehouseQueries(
      "ds_mw",
      buildManagedWarehouseContextualBanditQueries(staleSchema),
      staleSchema,
    );
    return (await model.getByDatasource("ds_mw"))[0];
  }

  it("rejects manual updates and deletes of a managed query", async () => {
    const { context } = makeContext();
    const model = new TestModel(context);
    const managed = await seedManaged(model);

    await expect(model.update(managed, { name: "renamed" })).rejects.toThrow(
      /Cannot update a Managed Warehouse/,
    );
    await expect(model.delete(managed)).rejects.toThrow(
      /Cannot delete a Managed Warehouse/,
    );
    expect(model.collection.docs).toHaveLength(2);
  });

  it("rejects manually creating a managed query or flagging one as managed", async () => {
    const { context } = makeContext();
    const model = new TestModel(context);

    await expect(
      model.create({
        owner: "",
        datasourceId: "ds_mw",
        name: "Fake managed",
        userIdType: "user_id",
        query: "SELECT 1",
        targetingAttributeColumns: ["country"],
        managedBy: "api",
      }),
    ).rejects.toThrow(/Cannot create a Managed Warehouse/);

    const custom = await model.create({
      owner: "",
      datasourceId: "ds_mw",
      name: "Custom",
      userIdType: "user_id",
      query: "SELECT 1",
      targetingAttributeColumns: ["country"],
    });
    await expect(model.update(custom, { managedBy: "api" })).rejects.toThrow(
      /Cannot update a Managed Warehouse/,
    );
  });

  it("still validates manual queries against the org's attribute schema", async () => {
    const { context } = makeContext();
    const model = new TestModel(context);

    await expect(
      model.create({
        owner: "",
        datasourceId: "ds_mw",
        name: "Custom",
        userIdType: "user_id",
        query: "SELECT 1",
        targetingAttributeColumns: ["browser"],
      }),
    ).rejects.toThrow(/not a saved targeting attribute/);
  });
});
