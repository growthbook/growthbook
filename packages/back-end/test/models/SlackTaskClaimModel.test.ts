import { vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ReqContextClass } from "back-end/src/services/context";
import { waitForIndexes } from "back-end/src/models/BaseModel";
import { getCollection } from "back-end/src/util/mongo.util";

let mongo: MongoMemoryServer;
const claims = () =>
  new ReqContextClass({
    org: {
      id: "org",
      name: "Org",
      ownerEmail: "admin@example.com",
      url: "",
      dateCreated: new Date(),
      members: [{ id: "admin", role: "admin" }],
    },
    user: { id: "admin", email: "admin@example.com" },
    auditUser: { id: "admin", email: "admin@example.com", name: "Admin" },
  }).models.slackTaskClaims;
const threadKey = `thread:${"a".repeat(64)}`;
const expire = (key: string) =>
  getCollection("slacktaskclaims").updateOne(
    { id: key },
    { $set: { expiresAt: new Date(0) } },
  );

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
  await getCollection("slacktaskclaims").deleteMany({});
});
afterEach(() => {
  vi.restoreAllMocks();
});

test("one worker holds a thread until it releases; other threads proceed", async () => {
  const held = await claims().acquireThreadLease(threadKey);
  if (!held) throw new Error("expected the first claim to succeed");
  expect(await claims().acquireThreadLease(threadKey)).toBeNull();
  expect(
    await claims().acquireThreadLease(`thread:${"b".repeat(64)}`),
  ).not.toBeNull();
  await claims().releaseThreadLease(threadKey, held);
  expect(await claims().acquireThreadLease(threadKey)).not.toBeNull();
});

test("a claim past its deadline is taken over without manual cleanup", async () => {
  await claims().acquireThreadLease(threadKey);
  await expire(threadKey);
  expect(await claims().acquireThreadLease(threadKey)).not.toBeNull();
});

test("a thread whose worker died mid-turn frees up within two minutes", async () => {
  const start = Date.now();
  await claims().acquireThreadLease(threadKey);
  vi.spyOn(Date, "now").mockReturnValue(start + 121_000);
  expect(await claims().acquireThreadLease(threadKey)).not.toBeNull();
});

test("renewing keeps a live turn's thread past the original expiry", async () => {
  const start = Date.now();
  const held = await claims().acquireThreadLease(threadKey);
  if (!held) throw new Error("expected the first claim to succeed");
  const now = vi.spyOn(Date, "now").mockReturnValue(start + 90_000);
  expect(await claims().renewThreadLease(threadKey, held)).toBe(true);
  now.mockReturnValue(start + 150_000);
  expect(await claims().acquireThreadLease(threadKey)).toBeNull();
});

test("a stale worker can neither renew nor release its successor's claim", async () => {
  const stale = await claims().acquireThreadLease(threadKey);
  if (!stale) throw new Error("expected the first claim to succeed");
  await expire(threadKey);
  const successor = await claims().acquireThreadLease(threadKey);
  if (!successor)
    throw new Error("expected the expired claim to be taken over");
  expect(await claims().renewThreadLease(threadKey, stale)).toBe(false);
  await claims().releaseThreadLease(threadKey, stale);
  expect(await claims().acquireThreadLease(threadKey)).toBeNull();
  expect(await claims().renewThreadLease(threadKey, successor)).toBe(true);
});

test("permanent claims are granted once", async () => {
  const key = `action:${"c".repeat(64)}`;
  expect(await claims().claimOnce(key)).toBe(true);
  expect(await claims().claimOnce(key)).toBe(false);
});
