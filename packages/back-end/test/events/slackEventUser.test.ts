import {
  getEventUserFormatted,
  getSlackMessageForNotificationEvent,
} from "back-end/src/events/handlers/slack/slack-event-handler-utils";

const dana = { id: "u_dana", name: "Dana", email: "dana@example.com" };

describe("getEventUserFormatted", () => {
  it.each([
    [
      "an org key assuming Dana's role",
      {
        type: "api_key",
        apiKey: "key_ci",
        name: "CI key",
        requestedBy: dana,
        assumedRole: true,
      },
      "Dana (dana@example.com) via CI key",
    ],
    [
      "a nameless org key",
      { type: "api_key", apiKey: "key_abcd1234" },
      "an API request with key ending in ...1234",
    ],
    ["the system", { type: "system" }, "an automated process"],
    ["no actor", undefined, "an unknown user"],
  ] as const)("credits %s", (_, user, expected) => {
    expect(getEventUserFormatted(user)).toBe(expected);
  });
});

// Events saved before revision payloads became references still get delivered
// and retried after an upgrade, so both shapes have to render.
describe("revision event messages", () => {
  const render = (event: string, object: Record<string, unknown>) =>
    getSlackMessageForNotificationEvent(
      {
        event,
        data: { object },
        user: { type: "system" },
      } as unknown as Parameters<typeof getSlackMessageForNotificationEvent>[0],
      "event-1",
    );
  const timeout = { id: "c_1", key: "timeout", name: "Timeout" };
  const testers = { id: "grp_1", name: "Testers" };

  it.each([
    [
      "feature.revision.approved",
      { feature: { id: "checkout" } },
      "*checkout*",
    ],
    ["feature.revision.approved", { featureId: "checkout" }, "*checkout*"],
    ["config.revision.published", { config: timeout }, "*Timeout*"],
    ["config.revision.published", { baseConfig: timeout }, "*Timeout*"],
    ["constant.revision.published", { constant: timeout }, "*Timeout*"],
    ["constant.revision.published", { baseConstant: timeout }, "*Timeout*"],
    ["savedGroup.revision.published", { savedGroup: testers }, "*Testers*"],
    ["savedGroup.revision.published", { baseSavedGroup: testers }, "*Testers*"],
  ])("names the entity for %s from %j", async (event, entity, expected) => {
    const message = await render(event, { version: 2, ...entity });
    expect(message?.text).toContain(expected);
  });
});
