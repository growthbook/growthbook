import path from "path";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { Agenda } from "agenda";
import type { Db } from "mongodb";

jest.setTimeout(60_000);

type AgendaVersion = "v5" | "v6";

type AgendaFactoryResult = {
  agenda: Agenda;
  db: Db;
  close: () => Promise<void>;
};

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 8_000,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timed out");
}

function resolveAgendaV5Mongodb(): {
  MongoClient: {
    connect: (uri: string) => Promise<{
      db: (name: string) => Db;
      close: () => Promise<void>;
    }>;
  };
} {
  const mongodbPath = require.resolve("mongodb", {
    paths: [path.dirname(require.resolve("agenda-v5"))],
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(mongodbPath);
}

async function createV5Agenda(
  uri: string,
  dbName: string,
): Promise<AgendaFactoryResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AgendaCtor = require("agenda-v5") as new (opts: {
    mongo: unknown;
    processEvery?: number;
    defaultLockLifetime?: number;
  }) => Agenda;

  const { MongoClient } = resolveAgendaV5Mongodb();
  const client = await MongoClient.connect(uri);
  const db = client.db(dbName);
  const agenda = new AgendaCtor({
    mongo: db,
    processEvery: 100,
    defaultLockLifetime: 60_000,
  });

  return {
    agenda,
    db,
    close: async () => {
      await agenda.stop();
      await client.close();
    },
  };
}

async function createV6Agenda(
  uri: string,
  dbName: string,
): Promise<AgendaFactoryResult> {
  const { Agenda } = await import("agenda");
  const { MongoBackend } = await import("@agendajs/mongo-backend");
  const { MongoClient } = await import("mongodb");

  const client = await MongoClient.connect(uri);
  const db = client.db(dbName);
  const agenda = new Agenda({
    backend: new MongoBackend({
      mongo: db,
      collection: "agendaJobs",
    }),
    processEvery: 100,
    defaultLockLifetime: 60_000,
  });
  await agenda.ready;

  return {
    agenda,
    db: db as unknown as Db,
    close: async () => {
      await agenda.stop();
      await client.close();
    },
  };
}

async function createAgenda(
  version: AgendaVersion,
  uri: string,
): Promise<AgendaFactoryResult> {
  const dbName = `parity_${version}`;
  if (version === "v5") {
    return createV5Agenda(uri, dbName);
  }
  return createV6Agenda(uri, dbName);
}

describe("agenda v5 vs v6 parity", () => {
  let mongod: MongoMemoryServer;
  let uri: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();
  });

  afterAll(async () => {
    await mongod.stop();
  });

  const versions: AgendaVersion[] = ["v5", "v6"];

  describe.each(versions)("%s", (version) => {
    let factory: AgendaFactoryResult | undefined;

    beforeEach(async () => {
      factory = await createAgenda(version, uri);
    });

    afterEach(async () => {
      if (factory) {
        await factory.close();
        factory = undefined;
      }
    });

    it("runs a scheduled job once with the expected data", async () => {
      const { agenda } = factory!;
      const seen: unknown[] = [];
      agenda.define("parity-once", async (job) => {
        seen.push(job.attrs.data);
      });
      await agenda.start();
      const job = agenda.create("parity-once", { n: 1 });
      job.schedule(new Date());
      await job.save();
      await waitFor(() => seen.length === 1);
      expect(seen).toEqual([{ n: 1 }]);
    });

    it("dedupes with unique() on a top-level key", async () => {
      const { agenda, db } = factory!;
      agenda.define("parity-uniq-top", async () => undefined);
      const a = agenda.create("parity-uniq-top", { experimentId: "e1" });
      a.unique({ experimentId: "e1" });
      a.schedule(new Date(Date.now() + 60_000));
      await a.save();
      const b = agenda.create("parity-uniq-top", { experimentId: "e1" });
      b.unique({ experimentId: "e1" });
      b.schedule(new Date(Date.now() + 60_000));
      await b.save();
      const count = await db
        .collection("agendaJobs")
        .countDocuments({ name: "parity-uniq-top" });
      expect(count).toBe(1);
    });

    it("dedupes with unique() on a data.* key", async () => {
      const { agenda, db } = factory!;
      agenda.define("parity-uniq-data", async () => undefined);
      const a = agenda.create("parity-uniq-data", { experimentId: "e2" });
      a.unique({ "data.experimentId": "e2" });
      a.schedule(new Date(Date.now() + 60_000));
      await a.save();
      const b = agenda.create("parity-uniq-data", { experimentId: "e2" });
      b.unique({ "data.experimentId": "e2" });
      b.schedule(new Date(Date.now() + 60_000));
      await b.save();
      const count = await db
        .collection("agendaJobs")
        .countDocuments({ name: "parity-uniq-data" });
      expect(count).toBe(1);
    });

    it("creates a single repeating job with unique({}) + repeatEvery", async () => {
      const { agenda, db } = factory!;
      agenda.define("parity-repeat", async () => undefined);
      const job = agenda.create("parity-repeat", {});
      job.unique({});
      job.repeatEvery("5 minutes");
      await job.save();
      const again = agenda.create("parity-repeat", {});
      again.unique({});
      again.repeatEvery("5 minutes");
      await again.save();
      const count = await db
        .collection("agendaJobs")
        .countDocuments({ name: "parity-repeat" });
      expect(count).toBe(1);
      const doc = await db.collection("agendaJobs").findOne({
        name: "parity-repeat",
      });
      expect(doc?.nextRunAt).toBeTruthy();
    });

    it("emits fail:<name> with job.attrs", async () => {
      const { agenda } = factory!;
      let failJob: { attrs?: { name?: string; data?: unknown } } | null = null;
      agenda.define("parity-boom", async () => {
        throw new Error("nope");
      });
      agenda.on("fail:parity-boom", (_err, job) => {
        failJob = job as { attrs?: { name?: string; data?: unknown } };
      });
      await agenda.start();
      const job = agenda.create("parity-boom", { x: 1 });
      job.schedule(new Date());
      await job.save();
      await waitFor(() => failJob !== null);
      expect(failJob?.attrs?.name).toBe("parity-boom");
      expect(failJob?.attrs?.data).toEqual({ x: 1 });
    });

    it("accepts define with concurrency/lockLimit options", async () => {
      const { agenda } = factory!;
      const seen: number[] = [];
      if (version === "v5") {
        agenda.define(
          "parity-opts",
          { concurrency: 1, lockLimit: 1 },
          async (job) => {
            seen.push((job.attrs.data as { n: number }).n);
          },
        );
      } else {
        agenda.define(
          "parity-opts",
          async (job) => {
            seen.push((job.attrs.data as { n: number }).n);
          },
          { concurrency: 1, lockLimit: 1 },
        );
      }
      await agenda.start();
      const job = agenda.create("parity-opts", { n: 7 });
      job.schedule(new Date());
      await job.save();
      await waitFor(() => seen.length === 1);
      expect(seen).toEqual([7]);
    });

    it("supports createIndex for deleteOldAgendaJobs", async () => {
      const { db } = factory!;
      await db
        .collection("agendaJobs")
        .createIndex({ lastFinishedAt: 1, nextRunAt: 1 });
      const indexes = await db.collection("agendaJobs").indexes();
      expect(
        indexes.some(
          (idx) =>
            idx.key && idx.key.lastFinishedAt === 1 && idx.key.nextRunAt === 1,
        ),
      ).toBe(true);
    });

    it("deletes finished non-repeating jobs older than one week", async () => {
      const { db } = factory!;
      const collection = db.collection("agendaJobs");
      const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
      await collection.insertMany([
        {
          name: "parity-old",
          lastFinishedAt: old,
          nextRunAt: null,
          type: "normal",
          priority: 0,
          data: {},
        },
        {
          name: "parity-keep-repeat",
          lastFinishedAt: old,
          nextRunAt: new Date(Date.now() + 60_000),
          type: "single",
          priority: 0,
          data: {},
        },
      ]);
      const res = await collection
        .find(
          {
            lastFinishedAt: {
              $lt: new Date(Date.now() - 7 * 24 * 3600 * 1000),
            },
            nextRunAt: null,
          },
          { projection: { _id: 1 } },
        )
        .toArray();
      expect(res).toHaveLength(1);
      const deleteRes = await collection.deleteMany({
        _id: { $in: res.map((r) => r._id) },
      });
      expect(deleteRes.deletedCount).toBe(1);
      expect(
        await collection.countDocuments({ name: "parity-keep-repeat" }),
      ).toBe(1);
    });
  });

  it("matches outcomes across v5 and v6 for a processed job", async () => {
    const results: Record<AgendaVersion, unknown[]> = { v5: [], v6: [] };
    for (const version of versions) {
      const f = await createAgenda(version, uri);
      try {
        const seen: unknown[] = [];
        f.agenda.define("parity-cross", async (job) => {
          seen.push(job.attrs.data);
        });
        await f.agenda.start();
        const job = f.agenda.create("parity-cross", { ok: true });
        job.schedule(new Date());
        await job.save();
        await waitFor(() => seen.length === 1);
        results[version] = seen;
      } finally {
        await f.close();
      }
    }
    expect(results.v5).toEqual(results.v6);
  });
});
