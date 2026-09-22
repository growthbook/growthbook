import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ReqContextClass } from "back-end/src/services/context";
import { waitForIndexes } from "back-end/src/models/BaseModel";
import { SlackAssistantThreadModel } from "back-end/src/models/SlackAssistantThreadModel";
import { getCollection } from "back-end/src/util/mongo.util";

let mongo: MongoMemoryServer;
const threadsFor = (orgId: string) =>
  new ReqContextClass({
    org: {
      id: orgId,
      name: orgId,
      ownerEmail: "admin@example.com",
      url: "",
      dateCreated: new Date(),
      members: [{ id: "admin", role: "admin" }],
    },
    user: { id: "admin", email: "admin@example.com" },
    auditUser: { id: "admin", email: "admin@example.com", name: "Admin" },
  }).models.slackAssistantThreads;
const identity = { teamId: "T1", channelId: "D1", rootTs: "123.456" };
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 30000);
afterAll(async () => {
  await waitForIndexes();
  await mongoose.disconnect();
  await mongo?.stop();
});
beforeEach(async () => {
  await getCollection("slackassistantthreads").deleteMany({});
});

test("an unknown thread has no binding", async () => {
  expect(
    await SlackAssistantThreadModel.dangerousGetForThread(identity),
  ).toBeNull();
});

test("a notification binds its thread to the sending org for 90 days", async () => {
  const before = Date.now();
  await threadsFor("org1").bindNotificationThread(identity);
  const bound = await SlackAssistantThreadModel.dangerousGetForThread(identity);
  expect(bound).toMatchObject({ ...identity, organization: "org1" });
  expect(bound?.expiresAt?.getTime()).toBeGreaterThanOrEqual(
    before + NINETY_DAYS_MS,
  );
});

test("an existing binding is never repointed at another org", async () => {
  await threadsFor("org1").bindNotificationThread(identity);
  await threadsFor("org2").bindNotificationThread(identity);
  const held = await threadsFor("org2").bindConversationThread(identity);
  expect(held.organization).toBe("org1");
  expect(held.expiresAt).toBeInstanceOf(Date);
  expect(
    (await SlackAssistantThreadModel.dangerousGetForThread(identity))
      ?.organization,
  ).toBe("org1");
});

test("conversing in a notification thread makes its binding permanent", async () => {
  await threadsFor("org1").bindNotificationThread(identity);
  const bound = await threadsFor("org1").bindConversationThread(identity);
  expect(bound.organization).toBe("org1");
  expect(bound.expiresAt).toBeUndefined();
  const stored = await getCollection("slackassistantthreads").findOne({
    teamId: "T1",
  });
  expect(stored).not.toHaveProperty("expiresAt");
});

test("a conversation binds a fresh thread without an expiry", async () => {
  const bound = await threadsFor("org1").bindConversationThread(identity);
  expect(bound).toMatchObject({ ...identity, organization: "org1" });
  expect(bound.expiresAt).toBeUndefined();
  expect(
    await threadsFor("org1").bindConversationThread({
      ...identity,
      rootTs: "999.999",
    }),
  ).toMatchObject({ rootTs: "999.999" });
});
