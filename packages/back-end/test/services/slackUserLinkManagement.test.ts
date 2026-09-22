import { slackUserLinkSchema } from "shared/validators";
import { MongoClient, ObjectId } from "mongodb";
import type { Context } from "back-end/src/models/BaseModel";
import { buildSlackLinkUrl } from "back-end/src/services/slack/slackLink";
import { SlackUserLinkModel } from "back-end/src/models/SlackUserLinkModel";
import { SlackWorkspaceConnectionModel } from "back-end/src/models/SlackWorkspaceConnectionModel";

const links: Record<string, unknown>[] = [];
const claims = new Set<string>();
const matches = (
  doc: Record<string, unknown>,
  query: Record<string, unknown>,
) => Object.entries(query).every(([key, value]) => doc[key] === value);

// Use a real collection's types, with database operations replaced by spies.
const collection = new MongoClient("mongodb://localhost:27017")
  .db("test")
  .collection("slackuserlinks");
jest.spyOn(collection, "createIndex").mockResolvedValue("slack_identity");
jest.spyOn(collection, "findOne").mockImplementation(async (query) => {
  const doc = links.find((doc) => matches(doc, query));
  return doc ? { ...doc, _id: new ObjectId() } : null;
});
const insertOne = jest
  .spyOn(collection, "insertOne")
  .mockImplementation(async (doc) => {
    links.push({ ...doc });
    return { acknowledged: true, insertedId: new ObjectId() };
  });
const updateOne = jest
  .spyOn(collection, "updateOne")
  .mockImplementation(async (query, update) => {
    if (Array.isArray(update)) throw new Error("Unexpected update pipeline");
    const current = links.find((doc) => matches(doc, query));
    if (current) Object.assign(current, update.$set);
    return {
      acknowledged: true,
      matchedCount: current ? 1 : 0,
      modifiedCount: current ? 1 : 0,
      upsertedCount: 0,
      upsertedId: null,
    };
  });
jest.spyOn(collection, "deleteOne").mockImplementation(async (query = {}) => {
  const i = links.findIndex((doc) => matches(doc, query));
  if (i < 0) return { acknowledged: true, deletedCount: 0 };
  links.splice(i, 1);
  return { acknowledged: true, deletedCount: 1 };
});
class TestSlackUserLinkModel extends SlackUserLinkModel {
  protected _dangerousGetCollection() {
    return collection;
  }
}
jest.mock("back-end/src/models/SlackWorkspaceConnectionModel", () => ({
  SlackWorkspaceConnectionModel: { dangerousGetForTeam: jest.fn() },
}));
const workspace = jest.mocked(
  SlackWorkspaceConnectionModel.dangerousGetForTeam,
);
const connectedWorkspace = (organization: string) => ({
  teamId: "T1",
  organization,
  dateCreated: new Date(),
  dateUpdated: new Date(),
});
const context = (organization: string, userId = "user1") =>
  ({
    userId,
    models: {
      slackTaskClaims: {
        claim: async (key: string) => {
          if (claims.has(key)) return false;
          claims.add(key);
          return true;
        },
      },
    },
    populateForeignRefs: jest.fn().mockResolvedValue(undefined),
    org: { id: organization, members: [{ id: userId }] },
  }) as Context;
const model = (organization: string, userId = "user1") =>
  new TestSlackUserLinkModel(context(organization, userId));
const proof = () =>
  new URL(
    buildSlackLinkUrl({ slackTeamId: "T1", slackUserId: "U1" }),
  ).searchParams.get("state") || "";

beforeEach(() => {
  jest.clearAllMocks();
  links.length = 0;
  claims.clear();
  workspace.mockResolvedValue(connectedWorkspace("org1"));
});
it("links two organizations only after separate consent and disconnects only the selected link", async () => {
  const state = proof();
  await model("org1").linkCurrentUser(state);
  expect(links).toHaveLength(1);
  workspace.mockResolvedValue(connectedWorkspace("org2"));
  await model("org2").linkCurrentUser(state);
  expect(links).toHaveLength(2);
  const first = slackUserLinkSchema.parse(links[0]);
  const second = slackUserLinkSchema.parse(links[1]);
  expect(first.linkId).not.toBe(second.linkId);
  expect(await model("org1").unlinkCurrentUser(first)).toBe(true);
  expect(links).toEqual([second]);
  workspace.mockResolvedValue(connectedWorkspace("org1"));
  await expect(model("org1").linkCurrentUser(state)).rejects.toThrow(
    "already been used",
  );
});
it("replaces only the consented organization's account and rejects previous consent replay", async () => {
  const originalProof = proof();
  await model("org1").linkCurrentUser(originalProof);
  workspace.mockResolvedValue(connectedWorkspace("org2"));
  await model("org2").linkCurrentUser(originalProof);
  workspace.mockResolvedValue(connectedWorkspace("org1"));
  const previous = slackUserLinkSchema.parse(links[0]);
  await model("org1", "user2").linkCurrentUser(proof());
  expect(links[0]).toMatchObject({
    organization: "org1",
    growthbookUserId: "user2",
  });
  expect(links[0].linkId).not.toBe(previous.linkId);
  expect(links[1]).toMatchObject({
    organization: "org2",
    growthbookUserId: "user1",
  });
  expect(await model("org1").unlinkCurrentUser(previous)).toBe(false);
  await expect(model("org1").linkCurrentUser(originalProof)).rejects.toThrow(
    "already been used",
  );
});
it("invalidates the old generation even when relinking to the same account", async () => {
  await model("org1").linkCurrentUser(proof());
  const previous = slackUserLinkSchema.parse(links[0]);
  await model("org1").linkCurrentUser(proof());
  expect(links[0].linkId).not.toBe(previous.linkId);
  expect(await model("org1").unlinkCurrentUser(previous)).toBe(false);
});
it("makes a repeated successful consent idempotent", async () => {
  const state = proof();
  await model("org1").linkCurrentUser(state);
  const original = { ...links[0] };
  await model("org1").linkCurrentUser(state);
  expect(links).toEqual([original]);
  expect(insertOne).toHaveBeenCalledTimes(1);
  expect(updateOne).not.toHaveBeenCalled();
});
it("requires a real workspace connection but no notification channels or admin permission", async () => {
  await model("org1").linkCurrentUser(proof());
  expect(workspace).toHaveBeenCalledWith("T1");
  await expect(model("org2").linkCurrentUser(proof())).rejects.toThrow(
    "not connected",
  );
  workspace.mockResolvedValue(null);
  await expect(model("org2").linkCurrentUser(proof())).rejects.toThrow(
    "not connected",
  );
  expect(links).toHaveLength(1);
});
it("rejects invalid proof and removed membership before storing a link", async () => {
  await expect(model("org1").linkCurrentUser("invalid")).rejects.toThrow(
    "valid Slack consent",
  );
  const removed = context("org1");
  removed.org.members = [];
  await expect(
    new TestSlackUserLinkModel(removed).linkCurrentUser(proof()),
  ).rejects.toThrow("valid Slack consent");
  expect(updateOne).not.toHaveBeenCalled();
});

it("retries a concurrent first link through the model update path", async () => {
  insertOne.mockImplementationOnce(async (doc) => {
    links.push({ ...doc, growthbookUserId: "user2", linkId: "concurrent" });
    throw Object.assign(new Error("duplicate"), { code: 11000 });
  });
  await model("org1").linkCurrentUser(proof());
  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({
    growthbookUserId: "user1",
    organization: "org1",
  });
  expect(links[0].linkId).not.toBe("concurrent");
  expect(updateOne).toHaveBeenCalledTimes(1);
});
