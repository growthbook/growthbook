import { getFeaturePageDefaultVersion } from "../src/revisions/featurePageVersion";

const user = (id: string) => ({ type: "dashboard", id });
// Newest first, the way the page and server both list revisions
const revisionList = [
  {
    version: 11,
    status: "draft",
    createdBy: { type: "api_key", id: "u_pat" },
    contributors: ["u_pat"],
  },
  {
    version: 10,
    status: "draft",
    createdBy: { type: "api_key", requestedBy: { id: "u_asker" } },
    contributors: ["u_asker"],
  },
  { version: 9, status: "draft", createdBy: user("u_other") },
  {
    version: 8,
    status: "draft",
    createdBy: { type: "system", subtype: "ramp-schedule" },
    contributors: ["u_me"],
  },
  { version: 7, status: "discarded", createdBy: user("u_me") },
  { version: 6, status: "pending-review", createdBy: user("u_me") },
  { version: 5, status: "draft", createdBy: user("u_me") },
  {
    version: 4,
    status: "draft",
    createdBy: user("u_x"),
    contributors: ["u_c"],
  },
  { version: 3, status: "published", createdBy: user("u_me") },
];
const pick = (requestedVersion: number | null, userId: string | null) =>
  getFeaturePageDefaultVersion({
    revisionList,
    liveVersion: 3,
    requestedVersion,
    userId,
  });

describe("getFeaturePageDefaultVersion", () => {
  it.each([
    ["a requested version that exists", 9, "u_me", 9],
    [
      "the newest open draft you made, skipping ramp and closed ones",
      null,
      "u_me",
      6,
    ],
    ["a draft you contributed to", null, "u_c", 4],
    ["live when you have no open draft", null, "u_none", 3],
    ["live for API keys", null, null, 3],
    ["live, skipping a draft an org key made for you", null, "u_asker", 3],
    ["a draft your personal token made", null, "u_pat", 11],
    ["your draft when the requested version doesn't exist", 99, "u_me", 6],
  ] as const)("opens on %s", (_, requested, userId, expected) => {
    expect(pick(requested, userId)).toBe(expected);
  });
});
