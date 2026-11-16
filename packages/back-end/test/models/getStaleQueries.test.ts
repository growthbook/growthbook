import mongoose from "mongoose";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";
import {
  createNewQuery,
  getStaleQueries,
} from "back-end/src/models/QueryModel";

const ORG = "org_1";
const STALE_MS = 5 * 60 * 1000;

// The model the module under test writes through, so a test can intercept the
// guarded updateMany and open the race window the fix is about.
const queryModel = () => mongoose.model("Query");

async function staleRunningQuery(): Promise<string> {
  const doc = await createNewQuery({
    organization: ORG,
    datasource: "ds_1",
    language: "sql",
    query: "SELECT 1",
    dependencies: [],
    running: true,
    queryType: "experimentResults",
  });
  // createNewQuery stamps a fresh heartbeat; back-date it past the 70s window
  await queryModel().updateOne(
    { id: doc.id },
    { $set: { heartbeat: new Date(Date.now() - STALE_MS) } },
  );
  return doc.id;
}

async function statusOf(id: string): Promise<string | undefined> {
  const doc = await queryModel().findOne({ id });
  return doc?.get("status");
}

describe("getStaleQueries", () => {
  beforeAll(async () => {
    await connectTestMongo();
  });

  afterAll(async () => {
    await disconnectTestMongo();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await queryModel().deleteMany({});
  });

  it("fails and returns a running query that stopped heartbeating", async () => {
    const id = await staleRunningQuery();

    const stale = await getStaleQueries();

    expect(stale).toEqual([{ id, organization: ORG }]);
    expect(await statusOf(id)).toBe("failed");
  });

  it("ignores a running query that is still heartbeating", async () => {
    await createNewQuery({
      organization: ORG,
      datasource: "ds_1",
      language: "sql",
      query: "SELECT 1",
      dependencies: [],
      running: true,
      queryType: "experimentResults",
    });

    expect(await getStaleQueries()).toEqual([]);
  });

  it("does not report a query that succeeded while the sweep was running", async () => {
    const racing = await staleRunningQuery();
    const stale = await staleRunningQuery();

    // Finish one query in the window between the find and the guarded write.
    // The write's own filter then skips it, and reporting it anyway would
    // error a snapshot whose query actually succeeded.
    const model = queryModel();
    const updateMany = model.updateMany.bind(model);
    jest
      .spyOn(model, "updateMany")
      .mockImplementationOnce((...args: Parameters<typeof updateMany>) => {
        const applied = model
          .updateOne({ id: racing }, { $set: { status: "succeeded" } })
          .then(() => updateMany(...args));
        return applied as ReturnType<typeof updateMany>;
      });

    const result = await getStaleQueries();

    expect(result).toEqual([{ id: stale, organization: ORG }]);
    expect(await statusOf(racing)).toBe("succeeded");
    expect(await statusOf(stale)).toBe("failed");
  });

  it("still reports a query someone else failed in the same window", async () => {
    const racing = await staleRunningQuery();

    const model = queryModel();
    const updateMany = model.updateMany.bind(model);
    jest
      .spyOn(model, "updateMany")
      .mockImplementationOnce((...args: Parameters<typeof updateMany>) => {
        const applied = model
          .updateOne(
            { id: racing },
            { $set: { status: "failed", error: "Query cancelled by user" } },
          )
          .then(() => updateMany(...args));
        return applied as ReturnType<typeof updateMany>;
      });

    // Dead either way, and its snapshot may still be holding a running
    // pointer, so the sweep has to keep reporting it.
    expect(await getStaleQueries()).toEqual([
      { id: racing, organization: ORG },
    ]);
  });
});
