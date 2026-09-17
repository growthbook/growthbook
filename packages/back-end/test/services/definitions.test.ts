import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getDefinitionsData } from "back-end/src/services/definitions";
import {
  getDefinitionsVersionCollections,
  waitForIndexes,
} from "back-end/src/models/BaseModel";
import { ReqContextClass } from "back-end/src/services/context";
import { encryptParams } from "back-end/src/services/datasource";
import { ReqContext } from "back-end/types/request";

// Legacy (non-BaseModel) collections whose write functions call
// touchDefinitionsVersion manually. Adding a collection here asserts that YOU
// have audited every write path of that model and added manual touches — see
// the "Definitions version invariant" section in
// .agents/guides/backend/model-patterns.md.
const LEGACY_TOUCHED_COLLECTIONS = [
  "metrics",
  "datasources",
  "dimensions",
  "tags",
  "facttables",
];

const ORG_ID = "org_definitions_guard";

type ReadMethod = "find" | "findOne" | "aggregate" | "countDocuments";
const READ_METHODS: ReadMethod[] = [
  "find",
  "findOne",
  "aggregate",
  "countDocuments",
];

describe("definitions version coverage guard", () => {
  let mongod: MongoMemoryServer;
  let context: ReqContext;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());

    context = new ReqContextClass({
      org: {
        id: ORG_ID,
        name: "Guard",
        ownerEmail: "test@test.com",
        url: "",
        dateCreated: new Date(),
        members: [],
      },
      auditUser: { id: "u1", email: "test@test.com", name: "Test" },
      teams: [],
      user: {
        id: "u1",
        email: "test@test.com",
        name: "Test",
        superAdmin: true,
      },
    }) as unknown as ReqContext;
    await waitForIndexes();

    // Seed a datasource with an event-forwarder-capable type so the nested
    // enrichment in getDataSourcesWithParams (event forwarder config lookup)
    // actually runs — an empty DB would hide nested reads from the guard.
    await mongoose.connection.db!.collection("datasources").insertOne({
      id: "ds_guard",
      organization: ORG_ID,
      name: "Guard DS",
      description: "",
      type: "bigquery",
      params: encryptParams({
        projectId: "p",
        clientEmail: "x@y.z",
        privateKey: "k",
      } as unknown as Parameters<typeof encryptParams>[0]),
      settings: {},
      projects: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  it("only reads collections whose writes bump the definitions version", async () => {
    const readCollections = new Set<string>();

    // Wrap the driver Collection read methods so we observe every DB read the
    // endpoint makes — both mongoose model queries and the native-driver reads
    // BaseModel uses go through this prototype.
    const proto = mongoose.mongo.Collection.prototype as unknown as Record<
      ReadMethod,
      (...args: unknown[]) => unknown
    >;
    const originals = {} as Record<ReadMethod, (...args: unknown[]) => unknown>;
    for (const method of READ_METHODS) {
      originals[method] = proto[method];
      proto[method] = function (
        this: { collectionName: string },
        ...args: unknown[]
      ) {
        readCollections.add(this.collectionName);
        return originals[method].apply(this, args);
      };
    }

    try {
      await getDefinitionsData(context);
    } finally {
      for (const method of READ_METHODS) {
        proto[method] = originals[method];
      }
    }

    // Sanity: the observation hook works and the nested datasource enrichment
    // ran (this is the exact shape of read a top-level audit misses).
    expect(readCollections).toContain("metrics");
    expect(readCollections).toContain("eventForwarderConfigs");

    const covered = new Set([
      ...getDefinitionsVersionCollections(),
      ...LEGACY_TOUCHED_COLLECTIONS,
    ]);
    const uncovered = [...readCollections].filter((c) => !covered.has(c));

    // If this fails: the definitions endpoint now reads a collection whose
    // writes do NOT bump the org's definitions version, so clients would get
    // stale 304s. Fix by setting `affectsDefinitionsVersion: true` on the
    // BaseModel, or (legacy models) adding touchDefinitionsVersion calls to
    // every write path and listing the collection in
    // LEGACY_TOUCHED_COLLECTIONS above.
    expect(uncovered).toEqual([]);
  }, 30000);
});
