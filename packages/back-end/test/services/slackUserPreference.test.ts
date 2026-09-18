import { slackTaskKey } from "back-end/src/services/slack/slackTaskSafety";
import {
  clearSlackDefaultOrganization,
  getSlackUserPreference,
  setSlackDefaultOrganization,
} from "back-end/src/services/slack/slackUserPreference";

const records = new Map<string, Record<string, unknown>>();
jest.mock("back-end/src/util/mongo.util", () => ({
  getCollection: () => ({
    findOne: async ({ _id }: { _id: string }) => records.get(_id) ?? null,
    updateOne: async (
      query: { _id: string },
      update: { $set: Record<string, unknown> },
      options?: { upsert: boolean },
    ) => {
      const current = records.get(query._id);
      if (current === undefined && options?.upsert !== true)
        return { matchedCount: 0 };
      records.set(query._id, { ...current, _id: query._id, ...update.$set });
      return { matchedCount: current === undefined ? 0 : 1 };
    },
    deleteOne: async ({ _id }: { _id: string }) => ({
      deletedCount: records.delete(_id) ? 1 : 0,
    }),
  }),
}));
const identity = { slackTeamId: "T1", slackUserId: "U1" };
beforeEach(() => records.clear());
it("returns no preference before a default organization is set", async () => {
  expect(await getSlackUserPreference(identity)).toBeNull();
});
it("stores a default organization keyed by the slack workspace and user", async () => {
  await setSlackDefaultOrganization(identity, "org1");
  const preference = await getSlackUserPreference(identity);
  if (preference === null) throw new Error("Expected a stored preference");
  expect(preference).toMatchObject({
    _id: slackTaskKey(["T1", "U1"]),
    slackTeamId: "T1",
    slackUserId: "U1",
    defaultOrganizationId: "org1",
  });
  expect(preference.dateUpdated).toBeInstanceOf(Date);
});
it("keeps one document holding the latest organization when set twice", async () => {
  await setSlackDefaultOrganization(identity, "org1");
  await setSlackDefaultOrganization(identity, "org2");
  expect(records.size).toBe(1);
  expect(await getSlackUserPreference(identity)).toMatchObject({
    _id: slackTaskKey(["T1", "U1"]),
    defaultOrganizationId: "org2",
  });
});
it("keeps independent documents per slack user and per workspace", async () => {
  const otherUser = { slackTeamId: "T1", slackUserId: "U2" };
  const otherWorkspace = { slackTeamId: "T2", slackUserId: "U1" };
  await setSlackDefaultOrganization(identity, "org1");
  await setSlackDefaultOrganization(otherUser, "org2");
  await setSlackDefaultOrganization(otherWorkspace, "org3");
  expect(records.size).toBe(3);
  expect(await getSlackUserPreference(identity)).toMatchObject({
    _id: slackTaskKey(["T1", "U1"]),
    defaultOrganizationId: "org1",
  });
  expect(await getSlackUserPreference(otherUser)).toMatchObject({
    _id: slackTaskKey(["T1", "U2"]),
    defaultOrganizationId: "org2",
  });
  expect(await getSlackUserPreference(otherWorkspace)).toMatchObject({
    _id: slackTaskKey(["T2", "U1"]),
    defaultOrganizationId: "org3",
  });
});
it("clears the default organization and tolerates clearing a missing one", async () => {
  await setSlackDefaultOrganization(identity, "org1");
  await clearSlackDefaultOrganization(identity);
  expect(records.size).toBe(0);
  expect(await getSlackUserPreference(identity)).toBeNull();
  await expect(
    clearSlackDefaultOrganization(identity),
  ).resolves.toBeUndefined();
});
