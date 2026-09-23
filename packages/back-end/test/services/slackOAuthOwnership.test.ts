import { vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ReqContextClass } from "back-end/src/services/context";
import { waitForIndexes } from "back-end/src/models/BaseModel";
import { getCollection } from "back-end/src/util/mongo.util";
import { decryptSlackBotToken } from "back-end/src/util/slackToken";
import { cancellableFetch } from "back-end/src/util/http.util";
import {
  connectSlackOAuthIntegration,
  connectSlackOAuthInstallFromSession,
  disconnectSlackWorkspace,
  getSlackOAuthAuthorizeUrl,
} from "back-end/src/services/slackIntegration";

vi.mock("back-end/src/util/http.util", () => ({
  cancellableFetch: vi.fn(),
}));
vi.mock("back-end/src/util/secrets", async () => ({
  ...(await vi.importActual<typeof import("back-end/src/util/secrets")>(
    "back-end/src/util/secrets",
  )),
  SLACK_CLIENT_ID: "client-id",
  SLACK_CLIENT_SECRET: "client-secret",
}));

const collection = () => getCollection("slackworkspaceconnections");
let mongo: MongoMemoryServer;
const makeContext = (id: string) =>
  new ReqContextClass({
    org: {
      id,
      name: id,
      ownerEmail: "admin@example.com",
      url: "",
      dateCreated: new Date(),
      members: [{ id: "admin", role: "admin" }],
    },
    user: { id: "admin", email: "admin@example.com" },
    auditUser: { id: "admin", email: "admin@example.com", name: "Admin" },
  });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  // The 1:1 indexes build in the background when the model is first
  // constructed; the concurrent-connect tests need them in place.
  makeContext("setup");
  await waitForIndexes();
}, 30000);
afterAll(async () => {
  await waitForIndexes();
  await mongoose.disconnect();
  await mongo?.stop();
});
beforeEach(async () => {
  vi.clearAllMocks();
  await collection().deleteMany({});
  vi.mocked(cancellableFetch).mockImplementation(async (url, options) => {
    expect(url).toBe("https://slack.com/api/oauth.v2.access");
    const teamId = new URLSearchParams(String(options?.body)).get("code");
    return {
      responseWithoutBody: { ok: true },
      stringBody: JSON.stringify({
        ok: true,
        access_token: `token-${teamId}`,
        team: { id: teamId, name: teamId },
      }),
    } as Awaited<ReturnType<typeof cancellableFetch>>;
  });
});

const connect = (context: ReqContextClass, teamId = "T1") =>
  connectSlackOAuthInstallFromSession({ context, code: teamId });

it.each(["GrowthBook", "Slack"])(
  "rejects a workspace owned by another org through a %s-initiated install",
  async (source) => {
    await connect(makeContext("org1"));
    const context = makeContext("org2");
    const state = new URL(getSlackOAuthAuthorizeUrl(context)).searchParams.get(
      "state",
    );
    if (!state) throw new Error("Expected OAuth state");
    await expect(
      source === "GrowthBook"
        ? connectSlackOAuthIntegration({ context, code: "T1", state })
        : connect(context),
    ).rejects.toThrow("already connected to another GrowthBook organization");
    expect(await collection().find({}).toArray()).toEqual([
      expect.objectContaining({ organization: "org1", teamId: "T1" }),
    ]);
  },
);

it("rejects a second workspace for the same organization", async () => {
  const context = makeContext("org1");
  await connect(context);
  await expect(connect(context, "T2")).rejects.toThrow(
    "already connected to another Slack workspace",
  );
  expect(await collection().countDocuments()).toBe(1);
});

it("reconnects the same pair and preserves the assistant setting", async () => {
  const context = makeContext("org1");
  await connect(context);
  await collection().updateOne(
    { organization: "org1", teamId: "T1" },
    { $set: { assistantEnabled: true, encryptedBotAccessToken: "old-token" } },
  );
  await expect(connect(context)).resolves.toMatchObject({
    slackConnection: { teamId: "T1", assistantEnabled: true },
  });
  const saved =
    await context.models.slackWorkspaceConnections.getByTeamId("T1");
  expect(decryptSlackBotToken(saved?.encryptedBotAccessToken ?? "")).toBe(
    "token-T1",
  );
  expect(await collection().countDocuments()).toBe(1);
});

it.each([
  { organizations: ["org1", "org2"], teams: ["T1", "T1"] },
  { organizations: ["org1", "org1"], teams: ["T1", "T2"] },
])(
  "allows only one concurrent connection for $organizations / $teams",
  async ({ organizations, teams }) => {
    const results = await Promise.allSettled(
      organizations.map((org, i) => connect(makeContext(org), teams[i])),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({
          message: expect.stringContaining("already connected"),
        }),
      }),
    ]);
    expect(await collection().countDocuments()).toBe(1);
  },
);

it("allows concurrent reinstalls of the same pair", async () => {
  const context = makeContext("org1");
  await expect(
    Promise.all([connect(context), connect(context)]),
  ).resolves.toHaveLength(2);
  expect(await collection().countDocuments()).toBe(1);
});

it("releases both sides of the mapping when disconnected", async () => {
  const first = makeContext("org1");
  await connect(first);
  await disconnectSlackWorkspace({ context: first, teamId: "T1" });
  await connect(makeContext("org2"), "T1");
  await connect(first, "T2");
  expect(
    await collection()
      .find({}, { projection: { _id: 0, teamId: 1, organization: 1 } })
      .toArray(),
  ).toEqual(
    expect.arrayContaining([
      { organization: "org1", teamId: "T2" },
      { organization: "org2", teamId: "T1" },
    ]),
  );
});
