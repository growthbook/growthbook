import {
  describeSdkPayloadSize,
  getSdkPayloadSizeLevel,
  nextNotifiedSdkPayloadSizeLevel,
  summarizeSdkPayloadSizeFixes,
  getSdkPayloadSizeRecommendations,
  measureSdkPayloadSize,
  shouldRecordSdkPayloadSize,
} from "../src/health/sdk-payload-size";

const MB = 1024 * 1024;
const limitBytes = 16 * MB;

describe("getSdkPayloadSizeLevel", () => {
  it.each([
    [7.9 * MB, "ok"],
    [8 * MB, "warning"],
    [12.8 * MB, "danger"],
    [16 * MB, "over-limit"],
  ])("%d bytes -> %s", (bytes, level) => {
    expect(getSdkPayloadSizeLevel({ bytes, limitBytes })).toBe(level);
  });

  it("measures against the database's own limit", () => {
    expect(
      getSdkPayloadSizeLevel({ bytes: 1.7 * MB, limitBytes: 2 * MB }),
    ).toBe("danger");
  });
});

describe("describeSdkPayloadSize", () => {
  it("states the share of the limit, rounded down", () => {
    expect(describeSdkPayloadSize({ bytes: 8.5 * MB, limitBytes })).toBe(
      "The SDK payload is 8.5 MB, 53% of the 16 MB cache limit.",
    );
    expect(
      describeSdkPayloadSize({ bytes: limitBytes - 1, limitBytes }),
    ).toContain("99% of the 16 MB cache limit. Past it");
    expect(describeSdkPayloadSize({ bytes: 17.4 * MB, limitBytes })).toBe(
      "The SDK payload is 17.4 MB, 108% of the 16 MB cache limit. SDKs get no updates until it's smaller.",
    );
  });
});

describe("nextNotifiedSdkPayloadSizeLevel", () => {
  it.each([
    ["rises and notifies", 13 * MB, "warning", "danger", true],
    ["skips levels when it jumps", 17 * MB, "ok", "over-limit", true],
    ["holds just under the threshold", 7.5 * MB, "warning", "warning", false],
    ["settles once well under", 7 * MB, "warning", "ok", false],
    ["settles one level at a time", 12 * MB, "over-limit", "danger", false],
  ] as const)("%s", (_, bytes, notified, level, notify) => {
    expect(
      nextNotifiedSdkPayloadSizeLevel({ bytes, limitBytes }, notified),
    ).toEqual({
      level,
      notify,
    });
  });
});

describe("measureSdkPayloadSize", () => {
  it("sizes breakdown entries in UTF-8 bytes", () => {
    const payload = { features: { f: "é😀" } };
    const size = measureSdkPayloadSize(payload, 9 * MB, limitBytes, null);
    expect(size.breakdown?.largestFeatures).toEqual([
      { id: "f", bytes: new TextEncoder().encode('"é😀"').length },
    ]);
  });

  it("skips the breakdown below the warning level", () => {
    const payload = { features: { f: { defaultValue: 1 } } };
    expect(
      measureSdkPayloadSize(payload, MB, limitBytes, null).breakdown,
    ).toBeNull();
  });

  it("names the largest features and saved groups once large", () => {
    const big = "x".repeat(9 * MB);
    const payload = {
      features: { small: { defaultValue: 1 }, huge: { defaultValue: big } },
      savedGroups: { grp_a: ["1", "2"] },
      encryptedExperiments: "abc",
    };
    const size = measureSdkPayloadSize(payload, 9 * MB, limitBytes, null);
    expect(size.breakdown?.largestFeatures.map((f) => f.id)).toEqual([
      "huge",
      "small",
    ]);
    expect(size.breakdown?.largestSavedGroups.map((g) => g.id)).toEqual([
      "grp_a",
    ]);
    expect(Object.keys(size.breakdown?.sections ?? {})).toEqual([
      "features",
      "savedGroups",
      "encryptedExperiments",
    ]);
  });
});

describe("reusing measurements across payload refreshes", () => {
  const payload = { features: { f: { defaultValue: 1 } } };
  const hour = 60 * 60 * 1000;
  const first = measureSdkPayloadSize(payload, 9 * MB, limitBytes, null);
  const at = (ms: number) => new Date(first.measuredAt.getTime() + ms);

  it("reuses a recent breakdown at the same level, and skips the write", () => {
    const next = measureSdkPayloadSize(
      payload,
      9.01 * MB,
      limitBytes,
      first,
      at(hour / 2),
    );
    expect(next.breakdown).toBe(first.breakdown);
    expect(shouldRecordSdkPayloadSize(first, next)).toBe(false);
  });

  it("reuses the breakdown while the level flaps, then measures hourly", () => {
    const dipped = measureSdkPayloadSize(
      payload,
      MB,
      limitBytes,
      first,
      at(60),
    );
    const back = measureSdkPayloadSize(
      payload,
      9 * MB,
      limitBytes,
      dipped,
      at(120),
    );
    const higher = measureSdkPayloadSize(
      payload,
      13 * MB,
      limitBytes,
      back,
      at(180),
    );
    expect(back.breakdown).toBe(first.breakdown);
    expect(higher.breakdown).toBe(first.breakdown);

    const later = measureSdkPayloadSize(
      payload,
      9 * MB,
      limitBytes,
      first,
      at(2 * hour),
    );
    expect(later.breakdown).not.toBe(first.breakdown);
    expect(shouldRecordSdkPayloadSize(first, later)).toBe(true);
  });

  it("measures early once the payload moves 5%, but not within 5 minutes", () => {
    const minutes = (m: number) => at(m * 60 * 1000);
    const shrunk = (m: number) =>
      measureSdkPayloadSize(payload, 8.5 * MB, limitBytes, first, minutes(m));
    expect(shrunk(2).breakdown).toBe(first.breakdown);
    expect(shrunk(10).breakdown).not.toBe(first.breakdown);
    expect(
      measureSdkPayloadSize(payload, 8.9 * MB, limitBytes, first, minutes(10))
        .breakdown,
    ).toBe(first.breakdown);
  });

  it("writes when the size moves more than 1%", () => {
    const next = measureSdkPayloadSize(
      payload,
      9.2 * MB,
      limitBytes,
      first,
      at(60),
    );
    expect(shouldRecordSdkPayloadSize(first, next)).toBe(true);
  });
});

describe("getSdkPayloadSizeRecommendations", () => {
  const size = {
    bytes: 10 * MB,
    limitBytes,
    measuredAt: new Date(),
    breakdown: {
      measuredAt: new Date(),
      bytes: 10 * MB,
      sections: {},
      largestFeatures: [
        { id: "huge", bytes: 6 * MB },
        { id: "tiny", bytes: 100 },
      ],
      largestSavedGroups: [{ id: "grp_big", bytes: 3 * MB }],
    },
  };

  it("recommends every applicable fix", () => {
    expect(
      getSdkPayloadSizeRecommendations(
        {
          languages: ["javascript"],
          sdkVersion: "1.6.0",
          projects: [],
          savedGroupFormat: "inline",
          includeDraftExperiments: true,
        },
        size,
      ),
    ).toEqual([
      { type: "saved-group-references" },
      { type: "limit-projects" },
      { type: "large-features", entries: [{ id: "huge", bytes: 6 * MB }] },
      {
        type: "large-saved-groups",
        entries: [{ id: "grp_big", bytes: 3 * MB }],
      },
      { type: "archive-stale-features" },
      {
        type: "optional-payload-settings",
        settings: ["includeDraftExperiments"],
      },
    ]);
  });

  it("skips references when the SDK cannot read them, and everything when ok", () => {
    const connection = {
      languages: ["javascript" as const],
      sdkVersion: "0.10.0",
      projects: ["prj_a"],
      savedGroupFormat: "inline" as const,
    };
    expect(
      getSdkPayloadSizeRecommendations(connection, size).map((r) => r.type),
    ).toEqual([
      "large-features",
      "large-saved-groups",
      "archive-stale-features",
    ]);
    expect(
      getSdkPayloadSizeRecommendations(connection, { ...size, bytes: MB }),
    ).toEqual([]);
  });
});

describe("summarizeSdkPayloadSizeFixes", () => {
  it("counts setting fixes per connection and merges the largest entries", () => {
    expect(
      summarizeSdkPayloadSizeFixes([
        {
          recommendations: [
            { type: "limit-projects" },
            {
              type: "large-features",
              entries: [
                { id: "a", bytes: 3 },
                { id: "b", bytes: 1 },
              ],
            },
          ],
        },
        {
          recommendations: [
            { type: "limit-projects" },
            { type: "saved-group-references" },
            { type: "large-features", entries: [{ id: "a", bytes: 5 }] },
          ],
        },
      ]),
    ).toEqual([
      { type: "saved-group-references", connections: 1 },
      {
        type: "large-features",
        entries: [
          { id: "a", bytes: 5 },
          { id: "b", bytes: 1 },
        ],
      },
      { type: "limit-projects", connections: 2 },
    ]);
  });
});
