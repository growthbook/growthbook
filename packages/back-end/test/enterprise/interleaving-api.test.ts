import {
  apiInterleavingSnapshotValidator,
  InterleavingInterface,
  InterleavingSnapshotInterface,
} from "shared/validators";
import {
  toApiInterleaving,
  toApiInterleavingSnapshot,
} from "back-end/src/enterprise/services/interleavingApi";
import {
  startInterleaving,
  stopInterleaving,
} from "back-end/src/enterprise/services/interleavingChanges";
import { interleavingChangeActions } from "back-end/src/services/confirmations";

class BadRequest extends Error {}

function interleaving(
  overrides: Partial<InterleavingInterface> = {},
): InterleavingInterface {
  return {
    id: "il_1",
    organization: "org_1",
    dateCreated: new Date("2026-10-01T00:00:00Z"),
    dateUpdated: new Date("2026-10-02T00:00:00Z"),
    name: "Search ranking",
    owner: "u_1",
    tags: [],
    archived: false,
    status: "draft",
    key: "search-ranking",
    trackingKey: "search-ranking",
    hashAttribute: "id",
    seed: "seed",
    variations: [
      { id: "v0", key: "popular", name: "Popular", config: "{}" },
      { id: "v1", key: "buyers-pick", name: "Buyer's pick", config: "{}" },
    ],
    jsonSchema: null,
    datasource: "ds_1",
    interleavingExposureQueryId: "ilq_1",
    userIdType: "user_id",
    metrics: [],
    runs: [],
    environmentSettings: { production: { enabled: true } },
    ...overrides,
  };
}

function makeContext() {
  const update = jest.fn(
    async (
      existing: InterleavingInterface,
      changes: Partial<InterleavingInterface>,
    ) => ({ ...existing, ...changes }),
  );
  const context = {
    org: { id: "org_1", members: [{ id: "u_1" }], settings: {} },
    environments: ["production", "dev"],
    actingUserId: "u_1",
    getUsersByIds: async () => [{ id: "u_1", email: "owner@example.com" }],
    auditLog: jest.fn(),
    throwBadRequestError: (message: string) => {
      throw new BadRequest(message);
    },
    throwNotFoundError: () => {
      throw new Error("not found");
    },
    models: { interleavings: { update } },
  };
  return { context, update };
}

describe("toApiInterleaving", () => {
  it("serializes dates and the json schema", () => {
    const date = new Date("2026-10-03T00:00:00Z");
    const api = toApiInterleaving(
      interleaving({
        dateStarted: date,
        jsonSchema: {
          schemaType: "schema",
          schema: "{}",
          simple: { type: "object", fields: [] },
          date,
          enabled: true,
        },
      }),
    );
    expect(api.dateCreated).toBe("2026-10-01T00:00:00.000Z");
    expect(api.dateStarted).toBe(date.toISOString());
    expect(api.jsonSchema?.date).toBe(date.toISOString());
    expect(api.key).toBe("search-ranking");
  });
});

describe("toApiInterleavingSnapshot", () => {
  it("drops internal fields and serializes dates", () => {
    const il = interleaving();
    const snapshot: InterleavingSnapshotInterface = {
      id: "ilsnp_1",
      organization: "org_1",
      dateCreated: new Date("2026-10-07T00:00:00Z"),
      dateUpdated: new Date("2026-10-07T00:01:00Z"),
      interleavingId: il.id,
      status: "running",
      runStarted: null,
      queries: [{ query: "q_1", status: "running", name: "ft_1" }],
      settings: {
        interleavingId: il.id,
        trackingKey: il.trackingKey,
        datasourceId: il.datasource,
        interleavingExposureQueryId: il.interleavingExposureQueryId,
        interleavingExposureQuerySql: "SELECT 1",
        userIdType: il.userIdType,
        variations: [
          { id: "v0", key: "popular", name: "Popular" },
          { id: "v1", key: "buyers-pick", name: "Buyer's pick" },
        ],
        metrics: [{ id: "fact__1", analyses: [{ type: "paired" }] }],
        pValueThreshold: 0.05,
        runs: [
          {
            dateStarted: new Date("2026-10-01T00:00:00Z"),
            dateEnded: new Date("2026-10-07T00:00:00Z"),
          },
        ],
        startDate: new Date("2026-10-01T00:00:00Z"),
        endDate: new Date("2026-10-07T00:00:00Z"),
      },
    };
    const api = toApiInterleavingSnapshot(snapshot);
    expect(apiInterleavingSnapshotValidator.safeParse(api).success).toBe(true);
    expect(api.dateCreated).toBe("2026-10-07T00:00:00.000Z");
    expect(api.runStarted).toBeNull();
    expect(api.settings.startDate).toBe("2026-10-01T00:00:00.000Z");
    expect(api.settings.endDate).toBe("2026-10-07T00:00:00.000Z");
    expect(api.settings).not.toHaveProperty("interleavingExposureQuerySql");
    expect(api).not.toHaveProperty("queries");
  });
});

describe("interleavingChangeActions", () => {
  it("holds any edit to a draft as draft work", () => {
    expect(
      interleavingChangeActions(interleaving(), { condition: "{}" }),
    ).toEqual(["experiment.draft"]);
  });

  it("holds edits to a running one by what they change", () => {
    const running = interleaving({ status: "running" });
    expect(
      interleavingChangeActions(running, {
        coverage: 0.5,
        environmentSettings: { production: { enabled: false } },
        seed: "new",
        variations: running.variations,
      }).sort(),
    ).toEqual([
      "experiment.phases",
      "experiment.targeting",
      "experiment.traffic",
    ]);
    expect(interleavingChangeActions(running, { name: "Renamed" })).toEqual([
      "experiment.draft",
    ]);
  });
});

describe("startInterleaving", () => {
  it("keeps the start date of a restarted one and opens a new run", async () => {
    const { context, update } = makeContext();
    const started = await startInterleaving(context as never, interleaving());
    expect(started.status).toBe("running");
    expect(started.dateStarted).toBeInstanceOf(Date);
    expect(update.mock.calls[0][1].runs).toHaveLength(1);

    const dateStarted = new Date("2026-10-05T00:00:00Z");
    const firstRun = {
      dateStarted,
      dateEnded: new Date("2026-10-06T00:00:00Z"),
    };
    await startInterleaving(
      context as never,
      interleaving({
        status: "stopped",
        dateStarted,
        dateStopped: firstRun.dateEnded,
        runs: [firstRun],
      }),
    );
    const restart = update.mock.calls[1][1];
    expect(restart.status).toBe("running");
    expect(restart.dateStarted).toEqual(dateStarted);
    expect(restart.dateStopped).toBeUndefined();
    // The dormant gap stays out of analysis: the old run keeps its end date and
    // a new one opens, rather than the original window being reopened.
    expect(restart.runs).toHaveLength(2);
    expect(restart.runs[0]).toEqual(firstRun);
    expect(restart.runs[1].dateEnded).toBeUndefined();
    expect(restart.runs[1].dateStarted.getTime()).toBeGreaterThanOrEqual(
      firstRun.dateEnded.getTime(),
    );
    expect(context.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "interleaving.start" }),
    );
  });

  it("refuses an archived one or one with no environment enabled", async () => {
    const { context, update } = makeContext();
    await expect(
      startInterleaving(context as never, interleaving({ archived: true })),
    ).rejects.toThrow(BadRequest);
    await expect(
      startInterleaving(
        context as never,
        interleaving({
          environmentSettings: { production: { enabled: false } },
        }),
      ),
    ).rejects.toThrow(/Enable at least one environment/);
    expect(update).not.toHaveBeenCalled();
  });

  it("leaves a running one alone", async () => {
    const { context, update } = makeContext();
    const running = interleaving({ status: "running" });
    expect(await startInterleaving(context as never, running)).toBe(running);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("stopInterleaving", () => {
  it("stops a running one and closes its open run", async () => {
    const { context } = makeContext();
    const dateStarted = new Date("2026-10-05T00:00:00Z");
    const stopped = await stopInterleaving(
      context as never,
      interleaving({ status: "running", runs: [{ dateStarted }] }),
    );
    expect(stopped.status).toBe("stopped");
    expect(stopped.dateStopped).toBeInstanceOf(Date);
    expect(stopped.runs).toHaveLength(1);
    expect(stopped.runs[0].dateStarted).toEqual(dateStarted);
    expect(stopped.runs[0].dateEnded).toEqual(stopped.dateStopped);
    expect(context.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "interleaving.stop" }),
    );
  });

  it("refuses a draft and leaves a stopped one alone", async () => {
    const { context, update } = makeContext();
    await expect(
      stopInterleaving(context as never, interleaving()),
    ).rejects.toThrow(BadRequest);
    const stopped = interleaving({ status: "stopped" });
    expect(await stopInterleaving(context as never, stopped)).toBe(stopped);
    expect(update).not.toHaveBeenCalled();
  });
});
