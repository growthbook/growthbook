import { startBypassCovers } from "../src/util";

describe("startBypassCovers", () => {
  const pinnedAt = "2026-10-23T02:59:07.060Z";
  const armed = (bypassApproval: boolean) => ({
    nextScheduledStatusUpdate: {
      type: "start",
      bypassApproval,
      pinnedDrafts: [
        { featureId: "flag", revisionVersion: 2, dateUpdated: pinnedAt },
      ],
    },
  });
  it.each([
    {
      name: "the pinned draft, unchanged",
      experiment: armed(true),
      draft: { version: 2, dateUpdated: pinnedAt },
      expected: true,
    },
    {
      name: "the pinned draft read back as a Date, as the server holds it",
      experiment: armed(true),
      draft: { version: 2, dateUpdated: new Date(pinnedAt) },
      expected: true,
    },
    {
      name: "a start scheduled without the bypass",
      experiment: armed(false),
      draft: { version: 2, dateUpdated: pinnedAt },
      expected: false,
    },
    {
      name: "the pinned draft, edited since",
      experiment: armed(true),
      draft: { version: 2, dateUpdated: "2026-10-24T00:00:00.000Z" },
      expected: false,
    },
    {
      name: "a newer draft than the pinned one",
      experiment: armed(true),
      draft: { version: 3, dateUpdated: pinnedAt },
      expected: false,
    },
    {
      name: "no confirmed start",
      experiment: { nextScheduledStatusUpdate: null },
      draft: { version: 2, dateUpdated: pinnedAt },
      expected: false,
    },
  ])("covers $name: $expected", ({ experiment, draft, expected }) => {
    expect(startBypassCovers(experiment, "flag", draft)).toBe(expected);
  });
});
