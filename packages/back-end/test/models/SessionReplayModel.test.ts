import { SessionReplayInterface } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import { SessionReplayModel } from "back-end/src/models/SessionReplayModel";
import {
  listSessionReplays,
  getSessionReplayChunksBySessionId,
  SessionReplayRow,
} from "back-end/src/services/clickhouse";
import { getSessionReplayEventsByStoragePrefix } from "back-end/src/services/session-replay";
import { logger } from "back-end/src/util/logger";

jest.mock("back-end/src/services/clickhouse", () => ({
  listSessionReplays: jest.fn(),
  getSessionReplayChunksBySessionId: jest.fn(),
}));

jest.mock("back-end/src/services/session-replay", () => ({
  getSessionReplayEventsByStoragePrefix: jest.fn(),
  filterClientKeysByProject: jest.requireActual<
    typeof import("back-end/src/services/session-replay")
  >("back-end/src/services/session-replay").filterClientKeysByProject,
}));

jest.mock("back-end/src/models/SdkConnectionModel", () => ({
  findSDKConnectionsByOrganization: jest
    .fn()
    .mockResolvedValue([{ key: "ck_test", projects: [] }]),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockListSessionReplays = jest.mocked(listSessionReplays);
const mockGetSessionReplayChunksBySessionId = jest.mocked(
  getSessionReplayChunksBySessionId,
);
const mockGetEvents = jest.mocked(getSessionReplayEventsByStoragePrefix);
const mockLoggerWarn = jest.mocked(logger.warn);

// ---------------------------------------------------------------------------
// Test subclass — exposes protected permission methods for direct testing
// ---------------------------------------------------------------------------

class TestableSessionReplayModel extends SessionReplayModel {
  publicCanRead(doc: Pick<SessionReplayInterface, "organization">): boolean {
    return this.canRead(doc);
  }
  publicCanDelete(doc: Pick<SessionReplayInterface, "organization">): boolean {
    return this.canDelete(doc);
  }
  publicCanCreate(): boolean {
    return this.canCreate();
  }
  publicCanUpdate(): boolean {
    return this.canUpdate();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(
  orgId = "org_1",
  {
    canView = true,
    canDelete = true,
  }: { canView?: boolean; canDelete?: boolean } = {},
): ReqContext {
  return {
    org: { id: orgId },
    permissions: {
      canViewSessionReplay: () => canView,
      canDeleteSessionReplay: () => canDelete,
    },
  } as unknown as ReqContext;
}

function makeRow(overrides: Partial<SessionReplayRow> = {}): SessionReplayRow {
  return {
    session_replay_id: "sess_abc123",
    organization: "org_1",
    client_key: "ck_test",
    user_id: "user_1",
    device_id: "device_1",
    s3_key: "org_1/sess_abc123/",
    started_at: "2026-04-29 17:42:11.000",
    ended_at: "2026-04-29 17:43:11.000",
    last_event_at: "2026-04-29 17:43:10.000",
    created_at: "2026-04-29 17:42:00.000",
    duration_ms: 60000,
    event_count: 150,
    error_count: 0,
    url_first: "https://example.com/page",
    urls_visited: ["https://example.com/page", "https://example.com/other"],
    page_title: "Example Page",
    viewport_width: 1440,
    viewport_height: 900,
    attributes: { plan: "pro" },
    feature_keys: ["feat_1"],
    experiment_keys: ["exp_1"],
    feature_evals: { items: [] },
    experiment_evals: { items: [] },
    session_events: { items: [] },
    country: "US",
    user_agent: "Mozilla/5.0",
    device: "desktop",
    browser: "Chrome",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Permission methods
// ---------------------------------------------------------------------------

describe("SessionReplayModel — permissions", () => {
  describe("canRead", () => {
    it("returns true when org matches and permission is granted", () => {
      const model = new TestableSessionReplayModel(
        makeContext("org_1", { canView: true }),
      );
      expect(model.publicCanRead({ organization: "org_1" })).toBe(true);
    });

    it("returns false when org does not match", () => {
      const model = new TestableSessionReplayModel(makeContext("org_1"));
      expect(model.publicCanRead({ organization: "org_2" })).toBe(false);
    });

    it("returns false when permission is denied even if org matches", () => {
      const model = new TestableSessionReplayModel(
        makeContext("org_1", { canView: false }),
      );
      expect(model.publicCanRead({ organization: "org_1" })).toBe(false);
    });
  });

  describe("canCreate", () => {
    it("always returns false", () => {
      const model = new TestableSessionReplayModel(makeContext());
      expect(model.publicCanCreate()).toBe(false);
    });
  });

  describe("canUpdate", () => {
    it("always returns false", () => {
      const model = new TestableSessionReplayModel(makeContext());
      expect(model.publicCanUpdate()).toBe(false);
    });
  });

  describe("canDelete", () => {
    it("returns true when org matches and permission is granted", () => {
      const model = new TestableSessionReplayModel(
        makeContext("org_1", { canDelete: true }),
      );
      expect(model.publicCanDelete({ organization: "org_1" })).toBe(true);
    });

    it("returns false when org does not match", () => {
      const model = new TestableSessionReplayModel(makeContext("org_1"));
      expect(model.publicCanDelete({ organization: "org_2" })).toBe(false);
    });

    it("returns false when permission is denied even if org matches", () => {
      const model = new TestableSessionReplayModel(
        makeContext("org_1", { canDelete: false }),
      );
      expect(model.publicCanDelete({ organization: "org_1" })).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// parseClickHouseDate — exercised via toInterface inside list()
// ---------------------------------------------------------------------------

describe("SessionReplayModel — parseClickHouseDate (via list)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("parses a space-separated ClickHouse DateTime string as UTC", async () => {
    const row = makeRow({ started_at: "2026-04-29 17:42:11.000" });
    mockListSessionReplays.mockResolvedValue([row]);

    const model = new SessionReplayModel(makeContext());
    const [session] = await model.list();

    expect(session.startedAt).toEqual(new Date("2026-04-29T17:42:11.000Z"));
  });

  it("passes through an already-ISO string (with T) unchanged", async () => {
    const row = makeRow({ started_at: "2026-04-29T17:42:11.000Z" });
    mockListSessionReplays.mockResolvedValue([row]);

    const model = new SessionReplayModel(makeContext());
    const [session] = await model.list();

    expect(session.startedAt).toEqual(new Date("2026-04-29T17:42:11.000Z"));
  });

  it("returns new Date(0) for an empty string", async () => {
    const row = makeRow({ started_at: "" });
    mockListSessionReplays.mockResolvedValue([row]);

    const model = new SessionReplayModel(makeContext());
    const [session] = await model.list();

    expect(session.startedAt).toEqual(new Date(0));
  });

  it("returns new Date(0) and warns for an unparseable string", async () => {
    const row = makeRow({ started_at: "not-a-date" });
    mockListSessionReplays.mockResolvedValue([row]);

    const model = new SessionReplayModel(makeContext());
    const [session] = await model.list();

    expect(session.startedAt).toEqual(new Date(0));
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ value: "not-a-date" }),
      expect.stringContaining("session-replay"),
    );
  });
});

// ---------------------------------------------------------------------------
// list()
// ---------------------------------------------------------------------------

describe("SessionReplayModel — list()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns an empty array when ClickHouse returns no rows", async () => {
    mockListSessionReplays.mockResolvedValue([]);
    const model = new SessionReplayModel(makeContext());
    await expect(model.list()).resolves.toEqual([]);
  });

  it("returns all rows when all pass permission checks", async () => {
    const rows = [
      makeRow({ session_replay_id: "sess_1" }),
      makeRow({ session_replay_id: "sess_2" }),
      makeRow({ session_replay_id: "sess_3" }),
    ];
    mockListSessionReplays.mockResolvedValue(rows);

    const model = new SessionReplayModel(
      makeContext("org_1", { canView: true }),
    );
    const result = await model.list();

    expect(result).toHaveLength(3);
    expect(result.map((s) => s.id)).toEqual(["sess_1", "sess_2", "sess_3"]);
  });

  it("returns empty when no SDK connections are permitted", async () => {
    const { findSDKConnectionsByOrganization } = jest.requireMock<
      typeof import("back-end/src/models/SdkConnectionModel")
    >("back-end/src/models/SdkConnectionModel");
    (findSDKConnectionsByOrganization as jest.Mock).mockResolvedValueOnce([]);

    const model = new SessionReplayModel(
      makeContext("org_1", { canView: true }),
    );
    await expect(model.list()).resolves.toEqual([]);
    expect(mockListSessionReplays).not.toHaveBeenCalled();
  });

  it("passes options through to listSessionReplays", async () => {
    mockListSessionReplays.mockResolvedValue([]);

    const model = new SessionReplayModel(makeContext());
    await model.list({
      userId: "u1",
      clientKey: "ck_1",
      country: "US",
      device: "desktop",
      minDurationSecs: 1.5,
      maxDurationSecs: 10,
      minEventCount: 5,
      maxEventCount: 25,
      featureKey: "flag_1",
      experimentKey: "exp_1",
      limit: 50,
      offset: 100,
    });

    expect(mockListSessionReplays).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "u1",
        clientKey: "ck_1",
        country: "US",
        device: "desktop",
        minDurationSecs: 1.5,
        maxDurationSecs: 10,
        minEventCount: 5,
        maxEventCount: 25,
        featureKey: "flag_1",
        experimentKey: "exp_1",
        limit: 50,
        offset: 100,
      }),
    );
  });

  it("correctly maps all snake_case row fields to camelCase interface fields", async () => {
    const row = makeRow();
    mockListSessionReplays.mockResolvedValue([row]);

    const model = new SessionReplayModel(makeContext());
    const [session] = await model.list();

    expect(session.id).toBe(row.session_replay_id);
    expect(session.organization).toBe(row.organization);
    expect(session.clientKey).toBe(row.client_key);
    expect(session.userId).toBe(row.user_id);
    expect(session.deviceId).toBe(row.device_id);
    expect(session.s3Key).toBe(row.s3_key);
    expect(session.durationMs).toBe(row.duration_ms);
    expect(session.eventCount).toBe(row.event_count);
    expect(session.errorCount).toBe(row.error_count);
    expect(session.urlFirst).toBe(row.url_first);
    expect(session.urlsVisited).toEqual(row.urls_visited);
    expect(session.pageTitle).toBe(row.page_title);
    expect(session.viewportWidth).toBe(row.viewport_width);
    expect(session.viewportHeight).toBe(row.viewport_height);
    expect(session.attributes).toEqual(row.attributes);
    expect(session.featureKeys).toEqual(row.feature_keys);
    expect(session.experimentKeys).toEqual(row.experiment_keys);
    expect(session.userAgent).toBe(row.user_agent);
    expect(session.country).toBe(row.country);
    expect(session.device).toBe(row.device);
    expect(session.browser).toBe(row.browser);
  });

  it("defaults null optional fields to empty strings, arrays, and zero", async () => {
    const row = makeRow({
      device_id: null as unknown as string,
      page_title: null as unknown as string,
      viewport_width: null as unknown as number,
      viewport_height: null as unknown as number,
      attributes: null as unknown as Record<string, string>,
      feature_keys: null as unknown as string[],
      experiment_keys: null as unknown as string[],
      country: null as unknown as string,
      device: null as unknown as string,
      browser: null as unknown as string,
    });
    mockListSessionReplays.mockResolvedValue([row]);

    const model = new SessionReplayModel(makeContext());
    const [session] = await model.list();

    expect(session.deviceId).toBe("");
    expect(session.pageTitle).toBe("");
    expect(session.viewportWidth).toBe(0);
    expect(session.viewportHeight).toBe(0);
    expect(session.attributes).toEqual({});
    expect(session.featureKeys).toEqual([]);
    expect(session.experimentKeys).toEqual([]);
    expect(session.country).toBe("");
    expect(session.device).toBe("");
    expect(session.browser).toBe("");
  });
});

// ---------------------------------------------------------------------------
// getBySessionId()
// ---------------------------------------------------------------------------

describe("SessionReplayModel — getBySessionId()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when ClickHouse finds no rows", async () => {
    mockGetSessionReplayChunksBySessionId.mockResolvedValue([]);

    const model = new SessionReplayModel(makeContext());
    await expect(model.getBySessionId("sess_missing")).resolves.toBeNull();
  });

  it("returns null when the row belongs to a different org", async () => {
    mockGetSessionReplayChunksBySessionId.mockResolvedValue([
      makeRow({ organization: "org_other" }),
    ]);

    const model = new SessionReplayModel(makeContext("org_1"));
    await expect(model.getBySessionId("sess_abc123")).resolves.toBeNull();
  });

  it("returns null when view permission is denied", async () => {
    mockGetSessionReplayChunksBySessionId.mockResolvedValue([makeRow()]);

    const model = new SessionReplayModel(
      makeContext("org_1", { canView: false }),
    );
    await expect(model.getBySessionId("sess_abc123")).resolves.toBeNull();
  });

  it("returns the mapped interface when the row is found and permitted", async () => {
    mockGetSessionReplayChunksBySessionId.mockResolvedValue([makeRow()]);

    const model = new SessionReplayModel(
      makeContext("org_1", { canView: true }),
    );
    const session = await model.getBySessionId("sess_abc123");

    expect(session).not.toBeNull();
    expect(session!.id).toBe("sess_abc123");
    expect(session!.organization).toBe("org_1");
  });

  it("aggregates multiple chunks correctly", async () => {
    mockGetSessionReplayChunksBySessionId.mockResolvedValue([
      makeRow({
        duration_ms: 30000,
        event_count: 50,
        error_count: 1,
        urls_visited: ["https://example.com/a"],
        feature_keys: ["feat_1"],
        experiment_keys: ["exp_1"],
        feature_evals: {
          items: [
            {
              featureKey: "feat_1",
              timestamp: 1000,
              result: { value: true },
            },
          ],
        },
        experiment_evals: { items: [] },
        session_events: {
          items: [{ eventName: "click", timestamp: 2000 }],
        },
      }),
      makeRow({
        duration_ms: 60000,
        event_count: 100,
        error_count: 2,
        urls_visited: ["https://example.com/b"],
        feature_keys: ["feat_2"],
        experiment_keys: ["exp_1", "exp_2"],
        feature_evals: { items: [] },
        experiment_evals: {
          items: [
            {
              key: "exp_2",
              timestamp: 3000,
              result: { value: "v", variationId: 1, featureId: null },
            },
          ],
        },
        session_events: {
          items: [{ eventName: "purchase", timestamp: 4000 }],
        },
      }),
    ]);

    const model = new SessionReplayModel(makeContext());
    const session = await model.getBySessionId("sess_abc123");

    expect(session).not.toBeNull();
    expect(session!.durationMs).toBe(60000);
    expect(session!.eventCount).toBe(150);
    expect(session!.errorCount).toBe(3);
    expect(session!.urlsVisited).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(session!.featureKeys).toEqual(["feat_1", "feat_2"]);
    expect(session!.experimentKeys).toEqual(["exp_1", "exp_2"]);
    expect(session!.featureEvals?.items).toHaveLength(1);
    expect(session!.experimentEvals?.items).toHaveLength(1);
    expect(session!.sessionEvents?.items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getEventsForS3Key()
// ---------------------------------------------------------------------------

describe("SessionReplayModel — getEventsForS3Key()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("strips the chunk filename and passes the directory prefix to the service", async () => {
    const events = [
      { type: 2, timestamp: 1000, data: {} },
      { type: 3, timestamp: 2000, data: {} },
    ];
    mockGetEvents.mockResolvedValue(events as never);

    const model = new SessionReplayModel(makeContext());
    const result = await model.getEventsForS3Key(
      "session-replays/org_1/2026/04/29/sess_abc123/0.json.gz",
    );

    expect(result).toEqual(events);
    expect(mockGetEvents).toHaveBeenCalledWith(
      "session-replays/org_1/2026/04/29/sess_abc123/",
    );
  });

  it("returns an empty array when the service returns no events", async () => {
    mockGetEvents.mockResolvedValue([]);

    const model = new SessionReplayModel(makeContext());
    const result = await model.getEventsForS3Key(
      "session-replays/org_1/2026/04/29/sess_empty/0.json.gz",
    );

    expect(result).toEqual([]);
  });
});
