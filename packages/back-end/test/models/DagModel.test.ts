import mongoose from "mongoose";
import { DagInterface } from "shared/validators";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";
import { DagModel, COLLECTION_NAME } from "back-end/src/models/DagModel";
import { waitForIndexes } from "back-end/src/models/BaseModel";
import type { Context } from "back-end/src/models/BaseModel";

const context = {
  org: { id: "org_1" },
  populateForeignRefs: jest.fn().mockResolvedValue(undefined),
  models: {},
} as unknown as Context;

describe("DagModel", () => {
  let model: DagModel;

  const collection = () => mongoose.connection.db!.collection(COLLECTION_NAME);

  async function seedDag(overrides: Partial<DagInterface> = {}) {
    const dag: DagInterface = {
      id: "dag_1",
      organization: "org_1",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      status: "active",
      nodes: [
        {
          id: "main",
          dependsOn: [],
          type: "experiment-snapshot",
          targetId: "snp_main",
          previousTargetIds: [],
          maxAttempts: 1,
        },
        {
          id: "dim_country",
          dependsOn: ["main"],
          type: "experiment-snapshot",
          targetId: "snp_a",
          previousTargetIds: [],
          maxAttempts: 3,
        },
      ],
      ...overrides,
    };
    await collection().insertOne({ ...dag });
    return dag;
  }

  const getNode = async (nodeId: string) =>
    (await model.getById("dag_1"))?.nodes.find((n) => n.id === nodeId);

  beforeAll(async () => {
    await connectTestMongo();
  }, 60000);

  afterAll(async () => {
    await disconnectTestMongo();
  });

  beforeEach(async () => {
    model = new DagModel(context);
    await waitForIndexes();
  });

  afterEach(async () => {
    await collection().deleteMany({});
  });

  it("swaps a node's target and records the failed attempt", async () => {
    const [, country] = (await seedDag()).nodes;

    expect(await model.replaceNodeTarget("dag_1", country, "snp_b")).toBe(true);

    expect(await getNode("dim_country")).toMatchObject({
      targetId: "snp_b",
      previousTargetIds: ["snp_a"],
    });
    expect(await getNode("main")).toMatchObject({
      targetId: "snp_main",
      previousTargetIds: [],
    });
  });

  it("lets only one of two swaps from the same attempt win", async () => {
    const [, country] = (await seedDag()).nodes;

    const results = await Promise.all([
      model.replaceNodeTarget("dag_1", country, "snp_b"),
      model.replaceNodeTarget("dag_1", country, "snp_c"),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await getNode("dim_country"))?.previousTargetIds).toEqual([
      "snp_a",
    ]);
  });

  it("records a retry that reuses the same target once per attempt", async () => {
    const [, country] = (await seedDag()).nodes;

    const results = await Promise.all([
      model.replaceNodeTarget("dag_1", country, "snp_a"),
      model.replaceNodeTarget("dag_1", country, "snp_a"),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const secondAttempt = await getNode("dim_country");
    expect(secondAttempt).toMatchObject({
      targetId: "snp_a",
      previousTargetIds: ["snp_a"],
    });

    // The same target failing again is a new attempt
    expect(
      secondAttempt &&
        (await model.replaceNodeTarget("dag_1", secondAttempt, "snp_a")),
    ).toBe(true);
    expect((await getNode("dim_country"))?.previousTargetIds).toEqual([
      "snp_a",
      "snp_a",
    ]);
  });

  it("keeps both of two concurrent swaps on different nodes", async () => {
    const [main, country] = (await seedDag()).nodes;

    const results = await Promise.all([
      model.replaceNodeTarget("dag_1", main, "snp_main_2"),
      model.replaceNodeTarget("dag_1", country, "snp_b"),
    ]);

    expect(results).toEqual([true, true]);
    expect(await getNode("main")).toMatchObject({
      targetId: "snp_main_2",
      previousTargetIds: ["snp_main"],
    });
    expect(await getNode("dim_country")).toMatchObject({
      targetId: "snp_b",
      previousTargetIds: ["snp_a"],
    });
  });

  it("refuses a swap on a done DAG or another organization's DAG", async () => {
    const [, country] = (await seedDag({ status: "done" })).nodes;
    expect(await model.replaceNodeTarget("dag_1", country, "snp_b")).toBe(
      false,
    );

    await collection().updateOne(
      { id: "dag_1" },
      { $set: { status: "active", organization: "org_2" } },
    );
    expect(await model.replaceNodeTarget("dag_1", country, "snp_b")).toBe(
      false,
    );
  });

  it("drops a done DAG from the active list but keeps the document", async () => {
    await seedDag();
    expect((await DagModel.dangerousFindAllActive()).map((d) => d.id)).toEqual([
      "dag_1",
    ]);

    await model.markDone("dag_1");

    expect(await DagModel.dangerousFindAllActive()).toEqual([]);
    expect((await model.getById("dag_1"))?.status).toBe("done");
  });
});
