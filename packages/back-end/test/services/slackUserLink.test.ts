import { parseSlackUserLink } from "back-end/src/services/slack/slackUserLink";

const identity = {
  slackTeamId: "T1",
  slackUserId: "U1",
  growthbookUserId: "user1",
  dateCreated: new Date("2026-09-01"),
  dateUpdated: new Date("2026-09-02"),
};

it("scopes old Mongoose records to their recorded organization", () => {
  expect(
    parseSlackUserLink({
      ...identity,
      organizationId: "org1",
      _id: "mongo-id",
      __v: 0,
    }),
  ).toMatchObject({
    ...identity,
    organization: "org1",
    linkId: expect.any(String),
  });
});
it("prefers the current organization over the old field", () => {
  expect(
    parseSlackUserLink({
      ...identity,
      organization: "org2",
      organizationId: "org1",
    }),
  ).toMatchObject({
    ...identity,
    organization: "org2",
    linkId: expect.any(String),
  });
});
it.each([
  { growthbookUserId: "" },
  { slackUserId: "" },
  { dateCreated: "invalid" },
])("rejects malformed stored links: %j", (invalid) => {
  expect(() =>
    parseSlackUserLink({ ...identity, organization: "org1", ...invalid }),
  ).toThrow();
});
it("rejects a link missing both old and new organization fields", () => {
  expect(() => parseSlackUserLink(identity)).toThrow();
});
