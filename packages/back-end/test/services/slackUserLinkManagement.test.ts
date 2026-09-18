import type { Context } from "back-end/src/models/BaseModel";
import { buildSlackLinkUrl } from "back-end/src/services/slack/slackLink";
import {
  linkSlackUser,
  unlinkSlackUser,
  parseSlackUserLink,
} from "back-end/src/services/slack/slackUserLink";

const links: Record<string, unknown>[] = [];
const claims = new Set<string>();
const matches = (
  doc: Record<string, unknown>,
  query: Record<string, unknown>,
) => Object.entries(query).every(([key, value]) => doc[key] === value);
const updateOne = jest.fn(
  async (
    query: Record<string, unknown>,
    update: {
      $set: Record<string, unknown>;
      $setOnInsert: Record<string, unknown>;
    },
  ) => {
    const current = links.find((doc) => matches(doc, query));
    if (current) Object.assign(current, update.$set);
    else links.push({ ...query, ...update.$set, ...update.$setOnInsert });
  },
);
const dropIndex = jest.fn();
const createIndex = jest.fn();
const updateMany = jest.fn();
const workspace = jest.fn();
jest.mock("back-end/src/util/mongo.util", () => ({
  ...jest.requireActual("back-end/src/util/mongo.util"),
  getCollection: (name: string) =>
    name === "slackworkspaceconnections"
      ? { findOne: (query: Record<string, unknown>) => workspace(query) }
      : name === "slacktaskclaims"
        ? {
            insertOne: async ({ _id }: { _id: string }) => {
              if (claims.has(_id))
                throw Object.assign(new Error("duplicate"), { code: 11000 });
              claims.add(_id);
            },
          }
        : {
            updateOne: (...args: Parameters<typeof updateOne>) =>
              updateOne(...args),
            updateMany: (...args: unknown[]) => updateMany(...args),
            createIndex: (...args: unknown[]) => createIndex(...args),
            dropIndex: (...args: unknown[]) => dropIndex(...args),
            findOne: async (query: Record<string, unknown>) =>
              links.find((doc) => matches(doc, query)) ?? null,
            deleteOne: async (query: Record<string, unknown>) => {
              const i = links.findIndex((doc) => matches(doc, query));
              if (i < 0) return { deletedCount: 0 };
              links.splice(i, 1);
              return { deletedCount: 1 };
            },
          },
}));
const context = (organization: string, userId = "user1") =>
  ({
    userId,
    org: { id: organization, members: [{ id: userId }] },
  }) as Context;
const proof = () =>
  new URL(
    buildSlackLinkUrl({ slackTeamId: "T1", slackUserId: "U1" }),
  ).searchParams.get("state") || "";

beforeEach(() => {
  jest.clearAllMocks();
  links.length = 0;
  claims.clear();
  workspace.mockResolvedValue({ teamId: "T1" });
});
it("links two organizations only after separate consent and disconnects only the selected link", async () => {
  const state = proof();
  await linkSlackUser(context("org1"), state);
  expect(links).toHaveLength(1);
  await linkSlackUser(context("org2"), state);
  expect(links).toHaveLength(2);
  const first = parseSlackUserLink(links[0]);
  const second = parseSlackUserLink(links[1]);
  expect(first.linkId).not.toBe(second.linkId);
  expect(await unlinkSlackUser(context("org1"), first)).toBe(true);
  expect(links).toEqual([second]);
  await expect(linkSlackUser(context("org1"), state)).rejects.toThrow(
    "already been used",
  );
});
it("replaces only the consented organization's account and rejects previous consent replay", async () => {
  const originalProof = proof();
  await linkSlackUser(context("org1"), originalProof);
  await linkSlackUser(context("org2"), originalProof);
  const previous = parseSlackUserLink(links[0]);
  await linkSlackUser(context("org1", "user2"), proof());
  expect(links[0]).toMatchObject({
    organization: "org1",
    growthbookUserId: "user2",
  });
  expect(links[0].linkId).not.toBe(previous.linkId);
  expect(links[1]).toMatchObject({
    organization: "org2",
    growthbookUserId: "user1",
  });
  expect(await unlinkSlackUser(context("org1"), previous)).toBe(false);
  await expect(linkSlackUser(context("org1"), originalProof)).rejects.toThrow(
    "already been used",
  );
});
it("invalidates the old generation even when relinking to the same account", async () => {
  await linkSlackUser(context("org1"), proof());
  const previous = parseSlackUserLink(links[0]);
  await linkSlackUser(context("org1"), proof());
  expect(links[0].linkId).not.toBe(previous.linkId);
  expect(await unlinkSlackUser(context("org1"), previous)).toBe(false);
});
it("makes a repeated successful consent idempotent", async () => {
  const state = proof();
  await linkSlackUser(context("org1"), state);
  const original = { ...links[0] };
  await linkSlackUser(context("org1"), state);
  expect(links).toEqual([original]);
  expect(updateOne).toHaveBeenCalledTimes(1);
});
it("requires a real workspace connection but no notification channels or admin permission", async () => {
  await linkSlackUser(context("org1"), proof());
  expect(workspace).toHaveBeenCalledWith({
    teamId: "T1",
    organization: "org1",
  });
  workspace.mockResolvedValue(null);
  await expect(linkSlackUser(context("org2"), proof())).rejects.toThrow(
    "not connected",
  );
  expect(links).toHaveLength(1);
});
it("rejects invalid proof and removed membership before storing a link", async () => {
  await expect(linkSlackUser(context("org1"), "invalid")).rejects.toThrow(
    "valid Slack consent",
  );
  const removed = context("org1");
  removed.org.members = [];
  await expect(linkSlackUser(removed, proof())).rejects.toThrow(
    "valid Slack consent",
  );
  expect(updateOne).not.toHaveBeenCalled();
});
it("awaits org-scoped index creation and removal of the old global constraint", async () => {
  await linkSlackUser(context("org1"), proof());
  expect(createIndex).toHaveBeenCalledWith(
    { slackTeamId: 1, slackUserId: 1, organization: 1 },
    { unique: true },
  );
  expect(dropIndex).toHaveBeenCalledWith("slackTeamId_1_slackUserId_1");
  expect(dropIndex.mock.invocationCallOrder[0]).toBeLessThan(
    updateOne.mock.invocationCallOrder[0],
  );
});
