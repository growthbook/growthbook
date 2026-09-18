import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { z } from "zod";
import { getCollection } from "back-end/src/util/mongo.util";
import {
  captureSlackLinkInteraction,
  completeSlackLinkRequest,
  dismissSlackLinkPrompt,
  postSlackAccountLink,
} from "back-end/src/services/slack/slackLinkRequests";
import {
  deleteSlackEphemeralMessage,
  postSlackEphemeralMessage,
} from "back-end/src/services/slack/slackWebApi";
import { verifySlackLinkState } from "back-end/src/services/slack/slackLink";

jest.mock("back-end/src/services/slack/slackWebApi", () => ({
  ...jest.requireActual("back-end/src/services/slack/slackWebApi"),
  deleteSlackEphemeralMessage: jest.fn(),
  postSlackEphemeralMessage: jest.fn(),
}));

const mention = {
  teamId: "T1",
  channelId: "C1",
  slackUserId: "U1",
  text: "<@BOT> What experiments are running?",
  messageTs: "123.456",
  threadTs: "123.000",
  botUserId: "BOT",
};
const responseUrl = "https://hooks.slack.com/actions/T1/callback";
const collection = () => getCollection("slacklinkrequests");
let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 30000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(postSlackEphemeralMessage).mockResolvedValue(true);
  jest.mocked(deleteSlackEphemeralMessage).mockResolvedValue(true);
  await collection().deleteMany({});
});

async function prompt(
  organizationId: string | null = null,
  resumeQuestion = true,
) {
  await postSlackAccountLink({
    mention,
    token: "token",
    text: "Link your account.",
    organizationId,
    resumeQuestion,
  });
  const message = jest.mocked(postSlackEphemeralMessage).mock.calls.at(-1)?.[0];
  const button = z
    .object({ value: z.string(), url: z.url() })
    .parse(z.array(z.unknown()).parse(message?.blocks?.[1].elements)[0]);
  return {
    nonce: button.value,
    state: new URL(button.url).searchParams.get("state") || "",
  };
}
const finish = (state: string, organizationId = "org1", userId = "user1") =>
  completeSlackLinkRequest({ state, organizationId, userId });
const click = (nonce: string, identity = {}) =>
  captureSlackLinkInteraction({ ...mention, nonce, responseUrl, ...identity });

it("keeps the original question server-side and ties the private button to signed consent", async () => {
  const { nonce, state } = await prompt();
  expect(verifySlackLinkState(state)).toMatchObject({
    nonce,
    slackTeamId: "T1",
    slackUserId: "U1",
  });
  const request = await finish(state);
  expect(request).toMatchObject({ mention, organizationId: null });
  expect(request?.resumeUntil?.getTime()).toBeGreaterThan(
    Date.now() + 9 * 60 * 1000,
  );
  expect(jest.mocked(postSlackEphemeralMessage).mock.calls[0][0]).toMatchObject(
    {
      user: "U1",
      channel: "C1",
      threadTs: "123.000",
      text: expect.stringContaining("within 10 minutes"),
    },
  );
  expect(await collection().indexes()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
    ]),
  );
});

it("dismisses the prompt after successful consent, not on the initial click", async () => {
  const { nonce, state } = await prompt();
  await click(nonce);
  expect(deleteSlackEphemeralMessage).not.toHaveBeenCalled();
  const request = await finish(state);
  if (!request) throw new Error("Missing completed request");
  await dismissSlackLinkPrompt(request);
  expect(deleteSlackEphemeralMessage).toHaveBeenCalledWith(responseUrl);
  expect(await finish(state)).toMatchObject({ responseUrl: null });
});

it("dismisses the prompt when the button callback arrives after consent", async () => {
  const { nonce, state } = await prompt();
  await finish(state);
  await click(nonce);
  expect(deleteSlackEphemeralMessage).toHaveBeenCalledTimes(1);
  expect(await finish(state)).toMatchObject({ responseUrl: null });
});

it.each([{ teamId: "T2" }, { channelId: "C2" }, { slackUserId: "U2" }])(
  "rejects a callback from a different Slack identity: %p",
  async (identity) => {
    const { nonce, state } = await prompt();
    await finish(state);
    await click(nonce, identity);
    expect(deleteSlackEphemeralMessage).not.toHaveBeenCalled();
    expect(await finish(state)).toMatchObject({ responseUrl: null });
  },
);

it("binds a pinned question to its organization and makes completion idempotent", async () => {
  const { state } = await prompt("org1");
  expect(await finish(state, "org2")).toBeNull();
  const original = await finish(state);
  expect(original?.linkedAccount).toMatchObject({
    organizationId: "org1",
    userId: "user1",
  });
  expect(await finish(state)).toEqual(original);
  expect(await finish(state, "org1", "another-user")).toBeNull();
});

it("chooses only one continuation when organizations finish linking concurrently", async () => {
  const { state } = await prompt();
  const results = await Promise.all([
    finish(state, "org1"),
    finish(state, "org2"),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
});

it("does not resume explicit link commands or complete expired requests", async () => {
  const { state } = await prompt(null, false);
  expect(await finish(state)).toMatchObject({ resumeUntil: null });
  await collection().updateMany({}, { $set: { expiresAt: new Date(0) } });
  expect(await finish(state)).toBeNull();
});

it("retains the callback for a retry if Slack cannot dismiss the prompt", async () => {
  const { nonce, state } = await prompt();
  await click(nonce);
  const request = await finish(state);
  if (!request) throw new Error("Missing completed request");
  jest.mocked(deleteSlackEphemeralMessage).mockResolvedValueOnce(false);
  await dismissSlackLinkPrompt(request);
  expect(await finish(state)).toMatchObject({ responseUrl });
  await dismissSlackLinkPrompt(request);
  expect(await finish(state)).toMatchObject({ responseUrl: null });
});
