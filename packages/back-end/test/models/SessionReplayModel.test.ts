import { SessionReplayInterface } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import { SessionReplayModel } from "back-end/src/models/SessionReplayModel";
import {
  listSessionReplays,
  getSessionReplayBySessionId,
  SessionReplayRow,
} from "back-end/src/services/clickhouse";
import { getSessionReplayEventsByStoragePrefix } from "back-end/src/services/session-replay";
import { logger } from "back-end/src/util/logger";

jest.mock("back-end/src/services/clickhouse", () => ({
  listSessionReplays: jest.fn(),
  getSessionReplayBySessionId: jest.fn(),
}));

jest.mock("back-end/src/services/session-replay", () => ({
  getSessionReplayEventsByStoragePrefix: jest.fn(),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: { warn: jest.fn() },
}));

const mockListSessionReplays = jest.mocked(listSessionReplays);
const mockGetSessionReplayBySessionId = jest.mocked(
  getSessionReplayBySessionId,
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
    session_id: "sess_abc123",
    org_id: "org_1",
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
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "spring",
    utm_term: "test",
    utm_content: "banner",
    attributes: { plan: "pro" },
    feature_evals: {
      items: [
        { featureKey: "feat_1", timestamp: 1000, result: { value: true } },
      ],
    },
    experiment_evals: {
      items: [
        {
          key: "exp_1",
          timestamp: 2000,
          result: { value: "control", variationId: 0, featureId: null },
        },
      ],
    },
    session_events: { items: [{ eventName: "click", timestamp: 3000 }] },
    country: "US",
    user_agent: "Mozilla/5.0",
    device: "desktop",
    browser: "Chrome",
    state: "finalized",
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
      makeRow({ session_id: "sess_1" }),
      makeRow({ session_id: "sess_2" }),
      makeRow({ session_id: "sess_3" }),
    ];
    mockListSessionReplays.mockResolvedValue(rows);

    const model = new SessionReplayModel(
      makeContext("org_1", { canView: true }),
    );
    const result = await model.list();

    expect(result).toHaveLength(3);
    expect(result.map((s) => s.sessionId)).toEqual([
      "sess_1",
      "sess_2",
      "sess_3",
    ]);
  });

  it("filters out rows from a different org", async () => {
    const rows = [
      makeRow({ session_id: "sess_1", org_id: "org_1" }),
      makeRow({ session_id: "sess_2", org_id: "org_other" }),
      makeRow({ session_id: "sess_3", org_id: "org_1" }),
    ];
    mockListSessionReplays.mockResolvedValue(rows);

    const model = new SessionReplayModel(
      makeContext("org_1", { canView: true }),
    );
    const result = await model.list();

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.sessionId)).toEqual(["sess_1", "sess_3"]);
  });

  it("filters out all rows when view permission is denied", async () => {
    mockListSessionReplays.mockResolvedValue([
      makeRow(),
      makeRow({ session_id: "sess_2" }),
    ]);

    const model = new SessionReplayModel(
      makeContext("org_1", { canView: false }),
    );
    await expect(model.list()).resolves.toEqual([]);
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

    expect(session.id).toBe(row.session_id);
    expect(session.organization).toBe(row.org_id);
    expect(session.sessionId).toBe(row.session_id);
    expect(session.clientKey).toBe(row.client_key);
    expect(session.userId).toBe(row.user_id);
    expect(session.deviceId).toBe(row.device_id);
    expect(session.storagePrefix).toBe(row.s3_key);
    expect(session.durationMs).toBe(row.duration_ms);
    expect(session.eventCount).toBe(row.event_count);
    expect(session.urlFirst).toBe(row.url_first);
    expect(session.urlsVisited).toEqual(row.urls_visited);
    expect(session.pageTitle).toBe(row.page_title);
    expect(session.viewportWidth).toBe(row.viewport_width);
    expect(session.viewportHeight).toBe(row.viewport_height);
    expect(session.utmSource).toBe(row.utm_source);
    expect(session.utmMedium).toBe(row.utm_medium);
    expect(session.utmCampaign).toBe(row.utm_campaign);
    expect(session.utmTerm).toBe(row.utm_term);
    expect(session.utmContent).toBe(row.utm_content);
    expect(session.attributes).toEqual(row.attributes);
    expect(session.featureEvals).toEqual(row.feature_evals);
    expect(session.experimentEvals).toEqual(row.experiment_evals);
    expect(session.sessionEvents).toEqual(row.session_events);
    expect(session.userAgent).toBe(row.user_agent);
    expect(session.state).toBe(row.state);
  });

  it("defaults null optional fields to empty strings and zero", async () => {
    const row = makeRow({
      device_id: null as unknown as string,
      page_title: null as unknown as string,
      viewport_width: null as unknown as number,
      viewport_height: null as unknown as number,
      utm_source: null as unknown as string,
      utm_medium: null as unknown as string,
      utm_campaign: null as unknown as string,
      utm_term: null as unknown as string,
      utm_content: null as unknown as string,
    });
    mockListSessionReplays.mockResolvedValue([row]);

    const model = new SessionReplayModel(makeContext());
    const [session] = await model.list();

    expect(session.deviceId).toBe("");
    expect(session.pageTitle).toBe("");
    expect(session.viewportWidth).toBe(0);
    expect(session.viewportHeight).toBe(0);
    expect(session.utmSource).toBe("");
    expect(session.utmMedium).toBe("");
    expect(session.utmCampaign).toBe("");
    expect(session.utmTerm).toBe("");
    expect(session.utmContent).toBe("");
  });

  it("defaults null nested eval columns to empty items arrays", async () => {
    const row = makeRow({
      attributes: null as unknown as Record<string, string>,
      feature_evals: null as unknown as SessionReplayRow["feature_evals"],
      experiment_evals: null as unknown as SessionReplayRow["experiment_evals"],
      session_events: null as unknown as SessionReplayRow["session_events"],
    });
    mockListSessionReplays.mockResolvedValue([row]);

    const model = new SessionReplayModel(makeContext());
    const [session] = await model.list();

    expect(session.attributes).toEqual({});
    expect(session.featureEvals).toEqual({ items: [] });
    expect(session.experimentEvals).toEqual({ items: [] });
    expect(session.sessionEvents).toEqual({ items: [] });
  });
});

// ---------------------------------------------------------------------------
// getBySessionId()
// ---------------------------------------------------------------------------

describe("SessionReplayModel — getBySessionId()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when ClickHouse finds no row", async () => {
    mockGetSessionReplayBySessionId.mockResolvedValue(null);

    const model = new SessionReplayModel(makeContext());
    await expect(model.getBySessionId("sess_missing")).resolves.toBeNull();
  });

  it("returns null when the row belongs to a different org", async () => {
    mockGetSessionReplayBySessionId.mockResolvedValue(
      makeRow({ org_id: "org_other" }),
    );

    const model = new SessionReplayModel(makeContext("org_1"));
    await expect(model.getBySessionId("sess_abc123")).resolves.toBeNull();
  });

  it("returns null when view permission is denied", async () => {
    mockGetSessionReplayBySessionId.mockResolvedValue(makeRow());

    const model = new SessionReplayModel(
      makeContext("org_1", { canView: false }),
    );
    await expect(model.getBySessionId("sess_abc123")).resolves.toBeNull();
  });

  it("returns the mapped interface when the row is found and permitted", async () => {
    mockGetSessionReplayBySessionId.mockResolvedValue(makeRow());

    const model = new SessionReplayModel(
      makeContext("org_1", { canView: true }),
    );
    const session = await model.getBySessionId("sess_abc123");

    expect(session).not.toBeNull();
    expect(session!.sessionId).toBe("sess_abc123");
    expect(session!.organization).toBe("org_1");
  });
});

// ---------------------------------------------------------------------------
// getEventsForStoragePrefix()
// ---------------------------------------------------------------------------

describe("SessionReplayModel — getEventsForStoragePrefix()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the events array from the service", async () => {
    const events = [
      { type: 2, timestamp: 1000, data: {} },
      { type: 3, timestamp: 2000, data: {} },
    ];
    mockGetEvents.mockResolvedValue(events as never);

    const model = new SessionReplayModel(makeContext());
    const result = await model.getEventsForStoragePrefix("org_1/sess_abc123/");

    expect(result).toEqual(events);
    expect(mockGetEvents).toHaveBeenCalledWith("org_1/sess_abc123/");
  });

  it("returns an empty array when the service returns no events", async () => {
    mockGetEvents.mockResolvedValue([]);

    const model = new SessionReplayModel(makeContext());
    const result = await model.getEventsForStoragePrefix("org_1/sess_empty/");

    expect(result).toEqual([]);
  });
});
