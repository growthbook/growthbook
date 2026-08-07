import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { z } from "zod";
import { MakeModelClass, waitForIndexes } from "back-end/src/models/BaseModel";
import type { Context } from "back-end/src/models/BaseModel";

// Minimal BaseModel-derived model used purely to exercise updateWithCas. It has
// a scalar (`counter`) and an array (`reviews`) field so we can guard on both.
const casTestSchema = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    counter: z.number(),
    reviews: z.array(z.object({ userId: z.string(), decision: z.string() })),
  })
  .strict();

const BaseClass = MakeModelClass({
  schema: casTestSchema,
  collectionName: "castestdocs",
  idPrefix: "cas_",
});

// Toggles let individual tests drive permission denial and count side effects.
let allowRead = true;
let allowUpdate = true;
let afterUpdateCalls = 0;

class CasTestModel extends BaseClass {
  protected canCreate(): boolean {
    return true;
  }
  protected canRead(): boolean {
    return allowRead;
  }
  protected canUpdate(): boolean {
    return allowUpdate;
  }
  protected canDelete(): boolean {
    return true;
  }
  protected async afterUpdate(): Promise<void> {
    afterUpdateCalls++;
  }
}

const context = {
  org: { id: "org_1" },
  populateForeignRefs: jest.fn().mockResolvedValue(undefined),
  registerTags: jest.fn().mockResolvedValue(undefined),
  models: {},
} as unknown as Context;

describe("BaseModel.updateWithCas", () => {
  let mongod: MongoMemoryServer;
  let model: CasTestModel;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    allowRead = true;
    allowUpdate = true;
    afterUpdateCalls = 0;
    model = new CasTestModel(context);
    await waitForIndexes();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  const rawCollection = () => mongoose.connection.db!.collection("castestdocs");

  it("applies a single guarded update and bumps dateUpdated", async () => {
    const created = await model.create({ counter: 0, reviews: [] });

    const updated = await model.updateWithCas(
      created.id,
      ["counter"],
      (existing) => ({ counter: existing.counter + 1 }),
    );

    expect(updated).not.toBeNull();
    expect(updated?.counter).toBe(1);
    expect(updated!.dateUpdated.getTime()).toBeGreaterThanOrEqual(
      created.dateUpdated.getTime(),
    );
    expect(afterUpdateCalls).toBe(1);
  });

  it("returns null when the doc does not exist", async () => {
    const result = await model.updateWithCas(
      "cas_missing",
      ["counter"],
      () => ({
        counter: 1,
      }),
    );
    expect(result).toBeNull();
  });

  it("returns null and writes nothing when compute aborts", async () => {
    const created = await model.create({ counter: 5, reviews: [] });

    const result = await model.updateWithCas(
      created.id,
      ["counter"],
      () => null,
    );

    expect(result).toBeNull();
    const fresh = await model.getById(created.id);
    expect(fresh?.counter).toBe(5);
    expect(afterUpdateCalls).toBe(0);
  });

  it("retries when a guarded field changes mid-flight, without losing the concurrent write", async () => {
    const created = await model.create({ counter: 0, reviews: [] });

    let computeCalls = 0;
    const updated = await model.updateWithCas(
      created.id,
      ["counter"],
      async (existing) => {
        computeCalls++;
        // Simulate a concurrent writer landing between our read and write on
        // the first attempt only. The guard (counter=0) will then miss.
        if (computeCalls === 1) {
          await rawCollection().updateOne(
            { id: created.id },
            { $set: { counter: 99 } },
          );
        }
        return { counter: existing.counter + 1 };
      },
    );

    expect(computeCalls).toBe(2);
    // Final value re-based on the concurrent write (99), not the stale read (0).
    expect(updated?.counter).toBe(100);
    expect(afterUpdateCalls).toBe(1);
  });

  it("does not lose updates under concurrent increments", async () => {
    const created = await model.create({ counter: 0, reviews: [] });

    const writers = 10;
    await Promise.all(
      Array.from({ length: writers }, () =>
        model.updateWithCas(
          created.id,
          ["counter"],
          (existing) => ({ counter: existing.counter + 1 }),
          { maxAttempts: 50 },
        ),
      ),
    );

    const fresh = await model.getById(created.id);
    expect(fresh?.counter).toBe(writers);
  });

  it("does not lose entries under concurrent array appends (addReview pattern)", async () => {
    const created = await model.create({ counter: 0, reviews: [] });

    const reviewers = ["u1", "u2", "u3", "u4", "u5"];
    await Promise.all(
      reviewers.map((userId) =>
        model.updateWithCas(
          created.id,
          ["reviews"],
          (existing) => ({
            reviews: [...existing.reviews, { userId, decision: "approve" }],
          }),
          { maxAttempts: 50 },
        ),
      ),
    );

    const fresh = await model.getById(created.id);
    expect(fresh?.reviews).toHaveLength(reviewers.length);
    expect(fresh?.reviews.map((r) => r.userId).sort()).toEqual(
      [...reviewers].sort(),
    );
  });

  it("throws after exhausting attempts when the guard never converges", async () => {
    const created = await model.create({ counter: 0, reviews: [] });

    await expect(
      model.updateWithCas(
        created.id,
        ["counter"],
        async (existing) => {
          // Always bump out-of-band so the guard can never match.
          await rawCollection().updateOne(
            { id: created.id },
            { $inc: { counter: 1 } },
          );
          return { counter: existing.counter + 1000 };
        },
        { maxAttempts: 3 },
      ),
    ).rejects.toThrow(/exhausted 3 attempts/);
  });

  it("returns null and writes nothing when read permission is denied", async () => {
    const created = await model.create({ counter: 0, reviews: [] });
    allowRead = false;

    let computeCalls = 0;
    const result = await model.updateWithCas(
      created.id,
      ["counter"],
      (existing) => {
        computeCalls++;
        return { counter: existing.counter + 1 };
      },
    );

    expect(result).toBeNull();
    expect(computeCalls).toBe(0);
    expect(afterUpdateCalls).toBe(0);
    allowRead = true;
    const fresh = await model.getById(created.id);
    expect(fresh?.counter).toBe(0);
  });

  it("propagates permission errors without retrying", async () => {
    const created = await model.create({ counter: 0, reviews: [] });
    allowUpdate = false;

    let computeCalls = 0;
    await expect(
      model.updateWithCas(created.id, ["counter"], (existing) => {
        computeCalls++;
        return { counter: existing.counter + 1 };
      }),
    ).rejects.toThrow(/do not have access/);

    expect(computeCalls).toBe(1);
    expect(afterUpdateCalls).toBe(0);
  });
});
