import {
  sessionReplayRrwebEventSchema,
  featureEvalItemSchema,
  experimentEvalItemSchema,
  sessionEventItemSchema,
  sessionReplayValidator,
} from "../../src/validators/session-replay";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validSession() {
  const now = new Date("2026-04-29T17:42:00.000Z");
  return {
    id: "sess_abc123",
    organization: "org_1",
    dateCreated: now,
    dateUpdated: now,
    clientKey: "ck_test",
    userId: "user_1",
    deviceId: "device_1",
    s3Key: "session-replays/org_1/2026/04/29/sess_abc123/0.json.gz",
    startedAt: now,
    endedAt: new Date("2026-04-29T17:43:00.000Z"),
    lastEventAt: new Date("2026-04-29T17:42:59.000Z"),
    durationMs: 60000,
    eventCount: 10,
    errorCount: 0,
    urlFirst: "https://example.com",
    urlsVisited: ["https://example.com"],
    pageTitle: "Home",
    viewportWidth: 1440,
    viewportHeight: 900,
    attributes: {},
    featureKeys: [],
    experimentKeys: [],
    featureEvals: { items: [] },
    experimentEvals: { items: [] },
    sessionEvents: { items: [] },
    userAgent: "Mozilla/5.0",
    country: "",
    device: "",
    browser: "",
  };
}

// ---------------------------------------------------------------------------
// sessionReplayRrwebEventSchema
// ---------------------------------------------------------------------------

describe("sessionReplayRrwebEventSchema", () => {
  it("accepts a minimal valid event", () => {
    const result = sessionReplayRrwebEventSchema.safeParse({
      type: 2,
      timestamp: 1000,
      data: {},
    });
    expect(result.success).toBe(true);
  });

  it("accepts data as any shape — including null and nested objects", () => {
    expect(
      sessionReplayRrwebEventSchema.safeParse({
        type: 3,
        timestamp: 1,
        data: null,
      }).success,
    ).toBe(true);
    expect(
      sessionReplayRrwebEventSchema.safeParse({
        type: 3,
        timestamp: 1,
        data: { adds: [{ id: 1 }] },
      }).success,
    ).toBe(true);
  });

  it("passes through unknown fields (.loose() contract)", () => {
    const input = {
      type: 2,
      timestamp: 1000,
      data: {},
      delay: 42,
      extra: "rrweb-field",
    };
    const result = sessionReplayRrwebEventSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as typeof input).delay).toBe(42);
      expect((result.data as typeof input).extra).toBe("rrweb-field");
    }
  });

  it("rejects a non-integer type (float)", () => {
    const result = sessionReplayRrwebEventSchema.safeParse({
      type: 2.5,
      timestamp: 1000,
      data: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing type field", () => {
    const result = sessionReplayRrwebEventSchema.safeParse({
      timestamp: 1000,
      data: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing timestamp field", () => {
    const result = sessionReplayRrwebEventSchema.safeParse({
      type: 2,
      data: {},
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// featureEvalItemSchema
// ---------------------------------------------------------------------------

describe("featureEvalItemSchema", () => {
  it("accepts a valid feature eval item", () => {
    const result = featureEvalItemSchema.safeParse({
      featureKey: "dark-mode",
      timestamp: 1000,
      result: { value: true },
    });
    expect(result.success).toBe(true);
  });

  it("accepts null as a result value", () => {
    const result = featureEvalItemSchema.safeParse({
      featureKey: "dark-mode",
      timestamp: 1000,
      result: { value: null },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an optional experimentKey in the result", () => {
    const result = featureEvalItemSchema.safeParse({
      featureKey: "dark-mode",
      timestamp: 1000,
      result: { value: "on", experimentKey: "exp_1" },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.result.experimentKey).toBe("exp_1");
  });

  it("rejects a missing featureKey", () => {
    const result = featureEvalItemSchema.safeParse({
      timestamp: 1000,
      result: { value: true },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// experimentEvalItemSchema
// ---------------------------------------------------------------------------

describe("experimentEvalItemSchema", () => {
  it("accepts a valid experiment eval item", () => {
    const result = experimentEvalItemSchema.safeParse({
      key: "exp_1",
      timestamp: 2000,
      result: { value: "control", variationId: 0, featureId: null },
    });
    expect(result.success).toBe(true);
  });

  it("name is optional", () => {
    const withName = experimentEvalItemSchema.safeParse({
      key: "exp_1",
      timestamp: 2000,
      name: "My Experiment",
      result: { value: "treatment", variationId: 1, featureId: "feat_1" },
    });
    expect(withName.success).toBe(true);

    const withoutName = experimentEvalItemSchema.safeParse({
      key: "exp_1",
      timestamp: 2000,
      result: { value: "control", variationId: 0, featureId: null },
    });
    expect(withoutName.success).toBe(true);
  });

  it("rejects a float variationId", () => {
    const result = experimentEvalItemSchema.safeParse({
      key: "exp_1",
      timestamp: 2000,
      result: { value: "control", variationId: 0.5, featureId: null },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sessionEventItemSchema
// ---------------------------------------------------------------------------

describe("sessionEventItemSchema", () => {
  it("accepts a minimal valid session event", () => {
    const result = sessionEventItemSchema.safeParse({
      eventName: "click",
      timestamp: 3000,
    });
    expect(result.success).toBe(true);
  });

  it("properties is optional", () => {
    const withProps = sessionEventItemSchema.safeParse({
      eventName: "purchase",
      timestamp: 3000,
      properties: { amount: 99, currency: "USD" },
    });
    expect(withProps.success).toBe(true);

    const withoutProps = sessionEventItemSchema.safeParse({
      eventName: "purchase",
      timestamp: 3000,
    });
    expect(withoutProps.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sessionReplayValidator
// ---------------------------------------------------------------------------

describe("sessionReplayValidator", () => {
  it("accepts a fully valid session object", () => {
    const result = sessionReplayValidator.safeParse(validSession());
    expect(result.success).toBe(true);
  });

  it("rejects a negative durationMs", () => {
    const result = sessionReplayValidator.safeParse({
      ...validSession(),
      durationMs: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a float durationMs", () => {
    const result = sessionReplayValidator.safeParse({
      ...validSession(),
      durationMs: 1000.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative eventCount", () => {
    const result = sessionReplayValidator.safeParse({
      ...validSession(),
      eventCount: -1,
    });
    expect(result.success).toBe(false);
  });

  it("accepts missing featureEvals, experimentEvals, and sessionEvents (optional)", () => {
    const session = validSession() as Record<string, unknown>;
    delete session.featureEvals;
    delete session.experimentEvals;
    delete session.sessionEvents;
    const result = sessionReplayValidator.safeParse(session);
    expect(result.success).toBe(true);
  });
});
