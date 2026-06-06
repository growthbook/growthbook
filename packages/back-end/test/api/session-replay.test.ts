import request from "supertest";
import {
  SessionReplayInterface,
  SessionReplayRrwebEvent,
} from "shared/validators";
import { setupApp } from "./api.setup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(
  overrides: Partial<SessionReplayInterface> = {},
): SessionReplayInterface {
  const now = new Date("2026-04-29T17:42:00.000Z");
  return {
    id: "sess_abc123",
    organization: "org_1",
    dateCreated: now,
    dateUpdated: now,
    sessionId: "sess_abc123",
    clientKey: "ck_test",
    userId: "user_1",
    deviceId: "device_1",
    storagePrefix: "org_1/sess_abc123/",
    startedAt: now,
    endedAt: new Date("2026-04-29T17:43:00.000Z"),
    lastEventAt: new Date("2026-04-29T17:42:59.000Z"),
    durationMs: 60000,
    eventCount: 10,
    urlFirst: "https://example.com",
    urlsVisited: ["https://example.com"],
    pageTitle: "Home",
    viewportWidth: 1440,
    viewportHeight: 900,
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    utmTerm: "",
    utmContent: "",
    attributes: {},
    featureEvals: { items: [] },
    experimentEvals: { items: [] },
    sessionEvents: { items: [] },
    userAgent: "Mozilla/5.0",
    state: "finalized",
    ...overrides,
  };
}

function makeEvent(
  overrides: Partial<SessionReplayRrwebEvent> = {},
): SessionReplayRrwebEvent {
  return { type: 2, timestamp: 1000, data: {}, ...overrides };
}

function makeSessionReplays(
  overrides: {
    list?: jest.Mock;
    getBySessionId?: jest.Mock;
    getEventsForStoragePrefix?: jest.Mock;
  } = {},
) {
  return {
    list: jest.fn().mockResolvedValue([]),
    getBySessionId: jest.fn().mockResolvedValue(null),
    getEventsForStoragePrefix: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("session-replay API", () => {
  const { app, setReqContext } = setupApp();
  const org = { id: "org_1" };

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // GET /session-replay/
  // -------------------------------------------------------------------------

  describe("GET /session-replay/", () => {
    it("returns 200 with an empty sessions array when there are no sessions", async () => {
      setReqContext({
        org,
        models: { sessionReplays: makeSessionReplays() },
      });

      const res = await request(app)
        .get("/session-replay/")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ sessions: [] });
    });

    it("returns 200 with a list of sessions", async () => {
      const sessions = [
        makeSession({ sessionId: "sess_1" }),
        makeSession({ sessionId: "sess_2" }),
      ];

      setReqContext({
        org,
        models: {
          sessionReplays: makeSessionReplays({
            list: jest.fn().mockResolvedValue(sessions),
          }),
        },
      });

      const res = await request(app)
        .get("/session-replay/")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(2);
    });

    it("returns only safe list metadata and derived filter keys", async () => {
      const sessions = [
        makeSession({
          featureEvals: {
            items: [
              {
                featureKey: "flag_1",
                timestamp: 1000,
                result: { value: "sensitive-value" },
              },
              {
                featureKey: "flag_1",
                timestamp: 2000,
                result: { value: "duplicate" },
              },
            ],
          },
          experimentEvals: {
            items: [
              {
                key: "exp_1",
                timestamp: 1000,
                result: {
                  value: "sensitive-variation",
                  variationId: 0,
                  featureId: null,
                },
              },
            ],
          },
          sessionEvents: {
            items: [
              {
                eventName: "purchase",
                timestamp: 3000,
                properties: { email: "user@example.com" },
              },
            ],
          },
        }),
      ];

      setReqContext({
        org,
        models: {
          sessionReplays: makeSessionReplays({
            list: jest.fn().mockResolvedValue(sessions),
          }),
        },
      });

      const res = await request(app)
        .get("/session-replay/")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.sessions[0].featureKeys).toEqual(["flag_1"]);
      expect(res.body.sessions[0].experimentKeys).toEqual(["exp_1"]);
      expect(res.body.sessions[0]).not.toHaveProperty("storagePrefix");
      expect(res.body.sessions[0]).not.toHaveProperty("attributes");
      expect(res.body.sessions[0]).not.toHaveProperty("featureEvals");
      expect(res.body.sessions[0]).not.toHaveProperty("experimentEvals");
      expect(res.body.sessions[0]).not.toHaveProperty("sessionEvents");
    });

    it("defaults to page 1 — calls list with offset 0 and limit 100", async () => {
      const listMock = jest.fn().mockResolvedValue([]);

      setReqContext({
        org,
        models: { sessionReplays: makeSessionReplays({ list: listMock }) },
      });

      await request(app)
        .get("/session-replay/")
        .set("Authorization", "Bearer foo");

      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100, offset: 0 }),
      );
    });

    it("calculates correct offset for page 2", async () => {
      const listMock = jest.fn().mockResolvedValue([]);

      setReqContext({
        org,
        models: { sessionReplays: makeSessionReplays({ list: listMock }) },
      });

      await request(app)
        .get("/session-replay/?page=2")
        .set("Authorization", "Bearer foo");

      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100, offset: 100 }),
      );
    });

    it("calculates correct offset for page 3", async () => {
      const listMock = jest.fn().mockResolvedValue([]);

      setReqContext({
        org,
        models: { sessionReplays: makeSessionReplays({ list: listMock }) },
      });

      await request(app)
        .get("/session-replay/?page=3")
        .set("Authorization", "Bearer foo");

      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100, offset: 200 }),
      );
    });

    it("passes userId filter through to the model", async () => {
      const listMock = jest.fn().mockResolvedValue([]);

      setReqContext({
        org,
        models: { sessionReplays: makeSessionReplays({ list: listMock }) },
      });

      await request(app)
        .get("/session-replay/?userId=user_42")
        .set("Authorization", "Bearer foo");

      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user_42" }),
      );
    });

    it("passes clientKey filter through to the model", async () => {
      const listMock = jest.fn().mockResolvedValue([]);

      setReqContext({
        org,
        models: { sessionReplays: makeSessionReplays({ list: listMock }) },
      });

      await request(app)
        .get("/session-replay/?clientKey=ck_abc")
        .set("Authorization", "Bearer foo");

      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ clientKey: "ck_abc" }),
      );
    });

    it("passes state filter through to the model", async () => {
      const listMock = jest.fn().mockResolvedValue([]);

      setReqContext({
        org,
        models: { sessionReplays: makeSessionReplays({ list: listMock }) },
      });

      await request(app)
        .get("/session-replay/?state=finalized")
        .set("Authorization", "Bearer foo");

      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ state: "finalized" }),
      );
    });

    it("passes url filter through to the model", async () => {
      const listMock = jest.fn().mockResolvedValue([]);

      setReqContext({
        org,
        models: { sessionReplays: makeSessionReplays({ list: listMock }) },
      });

      await request(app)
        .get("/session-replay/?url=https%3A%2F%2Fexample.com")
        .set("Authorization", "Bearer foo");

      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://example.com" }),
      );
    });

    it("passes new session replay filters through to the model", async () => {
      const listMock = jest.fn().mockResolvedValue([]);

      setReqContext({
        org,
        models: { sessionReplays: makeSessionReplays({ list: listMock }) },
      });

      await request(app)
        .get(
          "/session-replay/?country=US&device=desktop&durationMinSecs=1.5&durationMaxSecs=10&eventCountMin=5&eventCountMax=25&featureKey=flag_1&experimentKey=exp_1",
        )
        .set("Authorization", "Bearer foo");

      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({
          country: "US",
          device: "desktop",
          minDurationSecs: 1.5,
          maxDurationSecs: 10,
          minEventCount: 5,
          maxEventCount: 25,
          featureKey: "flag_1",
          experimentKey: "exp_1",
        }),
      );
    });

    it("returns 400 for invalid numeric filter values", async () => {
      setReqContext({
        org,
        models: { sessionReplays: makeSessionReplays() },
      });

      const res = await request(app)
        .get("/session-replay/?durationMinSecs=-1")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(400);
    });

    it("returns 400 for non-integer event count filter values", async () => {
      setReqContext({
        org,
        models: { sessionReplays: makeSessionReplays() },
      });

      const res = await request(app)
        .get("/session-replay/?eventCountMin=1.5")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(400);
    });

    it("returns 400 for oversized duration filter values", async () => {
      setReqContext({
        org,
        models: { sessionReplays: makeSessionReplays() },
      });

      const res = await request(app)
        .get("/session-replay/?durationMaxSecs=2592001")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(400);
    });

    it("returns 400 for oversized event count filter values", async () => {
      setReqContext({
        org,
        models: { sessionReplays: makeSessionReplays() },
      });

      const res = await request(app)
        .get("/session-replay/?eventCountMax=1000001")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(400);
    });

    it("returns 400 for overlong string filter values", async () => {
      setReqContext({
        org,
        models: { sessionReplays: makeSessionReplays() },
      });

      const res = await request(app)
        .get(`/session-replay/?featureKey=${"x".repeat(256)}`)
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(400);
    });

    it("returns 400 for an invalid state enum value", async () => {
      setReqContext({
        org,
        models: { sessionReplays: makeSessionReplays() },
      });

      const res = await request(app)
        .get("/session-replay/?state=unknown")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(400);
    });

    it("returns 400 for an unrecognised query parameter (strict schema)", async () => {
      setReqContext({
        org,
        models: { sessionReplays: makeSessionReplays() },
      });

      const res = await request(app)
        .get("/session-replay/?unknownParam=x")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // GET /session-replay/:sessionId
  // -------------------------------------------------------------------------

  describe("GET /session-replay/:sessionId", () => {
    it("returns 404 when the session does not exist", async () => {
      setReqContext({
        org,
        models: {
          sessionReplays: makeSessionReplays({
            getBySessionId: jest.fn().mockResolvedValue(null),
          }),
        },
      });

      const res = await request(app)
        .get("/session-replay/sess_missing")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ status: 404, message: "Session not found" });
    });

    it("returns 404 when the session exists but has no stored events", async () => {
      const session = makeSession();

      setReqContext({
        org,
        models: {
          sessionReplays: makeSessionReplays({
            getBySessionId: jest.fn().mockResolvedValue(session),
            getEventsForStoragePrefix: jest.fn().mockResolvedValue([]),
          }),
        },
      });

      const res = await request(app)
        .get("/session-replay/sess_abc123")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        status: 404,
        message: "Session data not found",
      });
    });

    it("returns 200 with events and metadata when session and events are found", async () => {
      const session = makeSession();
      const events = [makeEvent(), makeEvent({ type: 3, timestamp: 2000 })];

      setReqContext({
        org,
        models: {
          sessionReplays: makeSessionReplays({
            getBySessionId: jest.fn().mockResolvedValue(session),
            getEventsForStoragePrefix: jest.fn().mockResolvedValue(events),
          }),
        },
      });

      const res = await request(app)
        .get("/session-replay/sess_abc123")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(2);
      expect(res.body.metadata.sessionId).toBe("sess_abc123");
    });

    it("calls getEventsForStoragePrefix with the session's storagePrefix", async () => {
      const session = makeSession({ storagePrefix: "org_1/sess_abc123/" });
      const getEventsMock = jest.fn().mockResolvedValue([makeEvent()]);

      setReqContext({
        org,
        models: {
          sessionReplays: makeSessionReplays({
            getBySessionId: jest.fn().mockResolvedValue(session),
            getEventsForStoragePrefix: getEventsMock,
          }),
        },
      });

      await request(app)
        .get("/session-replay/sess_abc123")
        .set("Authorization", "Bearer foo");

      expect(getEventsMock).toHaveBeenCalledWith("org_1/sess_abc123/");
    });
  });
});
