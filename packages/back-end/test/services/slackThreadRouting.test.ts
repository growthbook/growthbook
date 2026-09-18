import {
  getSlackThread,
  pinSlackThreadOrganization,
  saveSlackOrganizationPicker,
  consumeSlackOrganizationSelection,
  slackConversationId,
  slackOrganizationPickerBlocks,
  SlackOrganizationSelection,
  SlackThread,
} from "back-end/src/services/slack/slackThreadRouting";

const records = new Map<string, Record<string, unknown>>();
jest.mock("back-end/src/util/mongo.util", () => ({
  getCollection: () => ({
    findOne: async ({ _id }: { _id: string }) => records.get(_id) ?? null,
    updateOne: async (
      query: {
        _id: string;
        status?: string | { $ne: string };
        selectionId?: string;
      },
      update: {
        $set: Record<string, unknown>;
        $unset?: Record<string, unknown>;
      },
      options?: { upsert: boolean },
    ) => {
      const current = records.get(query._id);
      const matches =
        current &&
        (typeof query.status === "string"
          ? current.status === query.status
          : current.status !== query.status?.$ne) &&
        (!query.selectionId || current.selectionId === query.selectionId);
      if (!matches && !options?.upsert) return { matchedCount: 0 };
      if (!matches && current)
        throw Object.assign(new Error("duplicate"), { code: 11000 });
      const next: Record<string, unknown> = {
        ...current,
        _id: query._id,
        ...update.$set,
      };
      for (const key of Object.keys(update.$unset || {})) delete next[key];
      records.set(query._id, next);
      return { matchedCount: matches ? 1 : 0 };
    },
  }),
}));
const identity = { teamId: "T1", channelId: "D1", rootTs: "123.456" };
const mention = {
  teamId: "T1",
  channelId: "D1",
  slackUserId: "U1",
  text: "Show my experiments",
  messageTs: "123.456",
};
const choices = [
  { organizationId: "org1", name: "First org", linkId: "link1" },
  { organizationId: "org2", name: "Second org", linkId: "link2" },
];
function selection(thread: SlackThread): SlackOrganizationSelection {
  if (thread.status !== "pending") throw new Error("Expected a pending picker");
  return {
    teamId: "T1",
    channelId: "D1",
    slackUserId: "U1",
    threadTs: "123.456",
    interactionTs: "123.789",
    selectionId: thread.selectionId,
    organizationId: "org2",
  };
}
beforeEach(() => records.clear());
it("persists a selected org and resumes exactly one copy of the original request", async () => {
  const pending = await saveSlackOrganizationPicker(mention, choices);
  const click = selection(pending);
  const results = await Promise.all([
    consumeSlackOrganizationSelection(click, "link2"),
    consumeSlackOrganizationSelection(click, "link2"),
  ]);
  expect(results.filter(Boolean)).toEqual([mention]);
  expect(await getSlackThread(identity)).toMatchObject({
    status: "selected",
    organizationId: "org2",
  });
  expect(await consumeSlackOrganizationSelection(click, "link2")).toBeNull();
});
it.each([
  { slackUserId: "U2" },
  { teamId: "T2" },
  { channelId: "C2" },
  { threadTs: "999.456" },
  { organizationId: "org3" },
  { selectionId: "stale" },
])("rejects a mismatched picker response: %j", async (overrides) => {
  const pending = await saveSlackOrganizationPicker(mention, choices);
  expect(
    await consumeSlackOrganizationSelection(
      { ...selection(pending), ...overrides },
      "link2",
    ),
  ).toBeNull();
  expect(await getSlackThread(identity)).toMatchObject({ status: "pending" });
});
it("rejects choices after relinking and superseding the question", async () => {
  const previous = await saveSlackOrganizationPicker(mention, choices);
  expect(
    await consumeSlackOrganizationSelection(
      selection(previous),
      "replacement-link",
    ),
  ).toBeNull();
  const next = await saveSlackOrganizationPicker(
    { ...mention, text: "New question" },
    choices,
  );
  expect(
    await consumeSlackOrganizationSelection(selection(previous), "link2"),
  ).toBeNull();
  expect(
    await consumeSlackOrganizationSelection(selection(next), "link2"),
  ).toMatchObject({ text: "New question" });
});
it("never changes a pinned org when another participant has a different unambiguous org", async () => {
  await pinSlackThreadOrganization(identity, "org1");
  expect(await pinSlackThreadOrganization(identity, "org2")).toMatchObject({
    status: "selected",
    organizationId: "org1",
  });
  expect(
    await saveSlackOrganizationPicker(
      { ...mention, slackUserId: "U2" },
      choices,
    ),
  ).toMatchObject({ status: "selected", organizationId: "org1" });
});
it("keeps conversation identity separate for Slack users, orgs, threads, accounts, and consent generations", () => {
  const original = {
    ...identity,
    organizationId: "org1",
    slackUserId: "U1",
    userId: "user1",
    linkId: "link1",
  };
  const id = slackConversationId(original);
  for (const overrides of [
    { organizationId: "org2" },
    { slackUserId: "U2" },
    { userId: "user2" },
    { linkId: "link2" },
    { rootTs: "1234.56" },
    { channelId: "C1" },
    { teamId: "T2" },
  ]) {
    expect(slackConversationId({ ...original, ...overrides })).not.toBe(id);
  }
  expect(slackConversationId(original)).toBe(id);
});
it("renders clickable choices with labels and a bound selection value", async () => {
  const thread = await saveSlackOrganizationPicker(mention, choices);
  if (thread.status !== "pending") throw new Error("Expected pending choices");
  expect(slackOrganizationPickerBlocks(thread)).toMatchObject([
    {
      accessory: {
        type: "static_select",
        action_id: "gb_select_organization",
        options: [
          {
            text: { text: "First org" },
            value: JSON.stringify({
              s: thread.selectionId,
              o: "org1",
              t: identity.rootTs,
            }),
          },
          {
            text: { text: "Second org" },
            value: JSON.stringify({
              s: thread.selectionId,
              o: "org2",
              t: identity.rootTs,
            }),
          },
        ],
      },
    },
  ]);
});
