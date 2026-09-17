import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { waitForIndexes } from "back-end/src/models/BaseModel";
import type { Context } from "back-end/src/models/BaseModel";
import { WatchModel } from "back-end/src/models/WatchModel";

function makeContext(orgId: string) {
  return {
    org: { id: orgId },
    populateForeignRefs: jest.fn().mockResolvedValue(undefined),
    registerTags: jest.fn().mockResolvedValue(undefined),
    models: {},
  } as unknown as Context;
}

describe("WatchModel.removeEntityFromAllWatchers", () => {
  let mongod: MongoMemoryServer;
  let watches: WatchModel;
  let otherOrgWatches: WatchModel;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    watches = new WatchModel(makeContext("org_1"));
    otherOrgWatches = new WatchModel(makeContext("org_2"));
    await waitForIndexes();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  it("removes a deleted feature from every watcher and keeps their other items", async () => {
    await watches.upsertWatch({
      userId: "u_1",
      type: "features",
      item: "feat_a",
    });
    await watches.upsertWatch({
      userId: "u_1",
      type: "features",
      item: "feat_b",
    });
    await watches.upsertWatch({
      userId: "u_1",
      type: "experiments",
      item: "exp_a",
    });
    await watches.upsertWatch({
      userId: "u_2",
      type: "features",
      item: "feat_a",
    });

    await watches.removeEntityFromAllWatchers({
      type: "features",
      item: "feat_a",
    });

    expect((await watches.getWatchedByUser("u_1"))?.features).toEqual([
      "feat_b",
    ]);
    expect((await watches.getWatchedByUser("u_1"))?.experiments).toEqual([
      "exp_a",
    ]);
    expect((await watches.getWatchedByUser("u_2"))?.features).toEqual([]);
    expect(await watches.getFeatureWatchers("feat_a")).toEqual([]);
  });

  it("removes a deleted experiment from every watcher", async () => {
    await watches.upsertWatch({
      userId: "u_1",
      type: "experiments",
      item: "exp_a",
    });
    await watches.upsertWatch({
      userId: "u_2",
      type: "experiments",
      item: "exp_a",
    });
    await watches.upsertWatch({
      userId: "u_2",
      type: "experiments",
      item: "exp_b",
    });

    await watches.removeEntityFromAllWatchers({
      type: "experiments",
      item: "exp_a",
    });

    expect(await watches.getExperimentWatchers("exp_a")).toEqual([]);
    expect((await watches.getWatchedByUser("u_2"))?.experiments).toEqual([
      "exp_b",
    ]);
  });

  it("does not change watch lists in other organizations", async () => {
    await watches.upsertWatch({
      userId: "u_1",
      type: "features",
      item: "feat_a",
    });
    await otherOrgWatches.upsertWatch({
      userId: "u_3",
      type: "features",
      item: "feat_a",
    });

    await watches.removeEntityFromAllWatchers({
      type: "features",
      item: "feat_a",
    });

    expect(await otherOrgWatches.getFeatureWatchers("feat_a")).toEqual(["u_3"]);
  });

  it("does nothing when no one watches the item", async () => {
    await watches.upsertWatch({
      userId: "u_1",
      type: "features",
      item: "feat_b",
    });

    await expect(
      watches.removeEntityFromAllWatchers({ type: "features", item: "feat_a" }),
    ).resolves.toBeUndefined();
    expect((await watches.getWatchedByUser("u_1"))?.features).toEqual([
      "feat_b",
    ]);
  });
});
