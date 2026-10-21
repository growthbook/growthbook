import { InterleavingInterface } from "shared/validators";
import { toApiInterleaving } from "back-end/src/enterprise/services/interleavingApi";
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
    interleavingQueryId: "ilq_1",
    userIdType: "user_id",
    metrics: [],
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
  it("starts a draft and keeps the start date of a restarted one", async () => {
    const { context, update } = makeContext();
    const started = await startInterleaving(context as never, interleaving());
    expect(started.status).toBe("running");
    expect(started.dateStarted).toBeInstanceOf(Date);

    const dateStarted = new Date("2026-10-05T00:00:00Z");
    await startInterleaving(
      context as never,
      interleaving({
        status: "stopped",
        dateStarted,
        dateStopped: new Date("2026-10-06T00:00:00Z"),
      }),
    );
    expect(update.mock.calls[1][1]).toEqual({
      status: "running",
      dateStarted,
      dateStopped: undefined,
    });
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
  it("stops a running one", async () => {
    const { context } = makeContext();
    const stopped = await stopInterleaving(
      context as never,
      interleaving({ status: "running" }),
    );
    expect(stopped.status).toBe("stopped");
    expect(stopped.dateStopped).toBeInstanceOf(Date);
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
