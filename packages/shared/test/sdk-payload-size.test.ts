import {
  getSdkPayloadSizeLevel,
  nextNotifiedSdkPayloadSizeLevel,
  summarizeSdkPayloadSizeFixes,
  getSdkPayloadSizeRecommendations,
  measureSdkPayloadSize,
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
  it("counts UTF-8 bytes and skips the breakdown below the warning level", () => {
    const payload = { features: { f: { defaultValue: "é" } } };
    const size = measureSdkPayloadSize(
      payload,
      JSON.stringify(payload),
      limitBytes,
    );
    expect(size.bytes).toBe(JSON.stringify(payload).length + 1);
    expect(size.breakdown).toBeNull();
  });

  it("names the largest features and saved groups once large", () => {
    const big = "x".repeat(9 * MB);
    const payload = {
      features: { small: { defaultValue: 1 }, huge: { defaultValue: big } },
      savedGroups: { grp_a: ["1", "2"] },
      encryptedExperiments: "abc",
    };
    const size = measureSdkPayloadSize(
      payload,
      JSON.stringify(payload),
      limitBytes,
    );
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

describe("getSdkPayloadSizeRecommendations", () => {
  const size = {
    bytes: 10 * MB,
    limitBytes,
    measuredAt: new Date(),
    breakdown: {
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
    ).toEqual(["large-features", "large-saved-groups"]);
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
