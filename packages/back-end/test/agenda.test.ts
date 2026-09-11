import Agenda from "agenda";
import { MongoClient, ObjectId } from "mongodb";

const MINUTE = 60 * 1000;
const LOCK_LIFETIME = 10 * MINUTE;

function createJob() {
  const agenda = new Agenda({ defaultLockLifetime: LOCK_LIFETIME });
  const jobId = new ObjectId();
  // Exercise Agenda's persistence code without connecting to MongoDB.
  agenda._collection = new MongoClient("mongodb://localhost:27017")
    .db("test")
    .collection("agendaJobs");
  const save = jest
    .spyOn(agenda._collection, "findOneAndUpdate")
    .mockImplementation(async (query, update) => ({
      ok: 1,
      value: { _id: query._id, ...update.$set },
    }));
  const job = agenda.create("slow-job", {});
  job.attrs._id = jobId;
  job.attrs.lockedAt = new Date();
  return { agenda, job, save };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it("renews a queued job's lock in the start save, keeping it valid until its first heartbeat", async () => {
  const { agenda, job, save } = createJob();
  const acquiredAt = Date.now();
  let finishWork = () => {};
  const work = new Promise<void>((resolve) => {
    finishWork = resolve;
  });
  agenda.define("slow-job", async () => work);
  const started = new Promise<void>((resolve) => {
    agenda.once("start", () => resolve());
  });

  jest.setSystemTime(acquiredAt + 2 * MINUTE);
  const startedAt = new Date();
  const completion = job.run();
  await started;

  try {
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(
      { _id: job.attrs._id },
      {
        $set: expect.objectContaining({
          lastRunAt: startedAt,
          lockedAt: startedAt,
        }),
      },
      { returnDocument: "after" },
    );

    // The acquisition lease expires before the first heartbeat at minute 11.
    jest.setSystemTime(acquiredAt + 10.5 * MINUTE);
    expect(job.attrs.lockedAt?.getTime()).toBeGreaterThan(
      Date.now() - LOCK_LIFETIME,
    );

    jest.setSystemTime(startedAt.getTime() + 9 * MINUTE);
    await job.touch();
    expect(save).toHaveBeenCalledTimes(2);
    expect(job.attrs.lockedAt).toEqual(new Date());
    expect(job.attrs.lastRunAt).toEqual(startedAt);
  } finally {
    finishWork();
    await completion;
  }

  expect(job.attrs.lockedAt).toBeNull();
  expect(save).toHaveBeenLastCalledWith(
    { _id: job.attrs._id },
    { $set: expect.objectContaining({ lockedAt: null }) },
    { returnDocument: "after" },
  );
});

it.each([false, true])(
  "preserves recurring scheduling and releases the lock when the processor fails: %s",
  async (failProcessor) => {
    const { agenda, job } = createJob();
    agenda.define("slow-job", async () => {
      if (failProcessor) throw new Error("processor failed");
    });
    job.repeatEvery("5 minutes");
    jest.setSystemTime(Date.now() + 2 * MINUTE);
    const startedAt = new Date();

    await job.run();

    expect(job.attrs.nextRunAt).toEqual(
      new Date(startedAt.getTime() + 5 * MINUTE),
    );
    expect(job.attrs.lockedAt).toBeNull();
    if (failProcessor) {
      expect(job.attrs.failReason).toBe("processor failed");
      expect(job.attrs.failedAt).toEqual(startedAt);
    } else {
      expect(job.attrs.lastFinishedAt).toEqual(startedAt);
    }
  },
);
