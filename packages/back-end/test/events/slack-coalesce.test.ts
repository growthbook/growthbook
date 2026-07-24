import { EventInterface } from "shared/types/events/event";
import {
  composeCoalescedSlackMessage,
  SlackMessage,
} from "back-end/src/events/handlers/slack/slack-event-handler-utils";

const makeEvent = (overrides: Partial<EventInterface> = {}): EventInterface =>
  ({
    id: "event-1",
    version: 1,
    event: "experiment.updated",
    dateCreated: new Date(),
    organizationId: "org_1",
    object: "experiment",
    objectId: "exp_abc",
    data: {
      data: {
        object: { id: "exp_abc", name: "Checkout CTA" },
      },
    },
    ...overrides,
  }) as unknown as EventInterface;

const makeMessage = (overrides: Partial<SlackMessage> = {}): SlackMessage => ({
  text: "default text",
  blocks: [
    {
      type: "section",
      text: { type: "mrkdwn", text: "default body" },
    },
  ],
  ...overrides,
});

describe("composeCoalescedSlackMessage", () => {
  it("returns null for an empty list", () => {
    expect(composeCoalescedSlackMessage([])).toBeNull();
  });

  it("returns the single message untouched when only one event rendered", () => {
    const message = makeMessage({ text: "solo" });
    const result = composeCoalescedSlackMessage([
      { event: makeEvent(), message },
    ]);
    expect(result).toBe(message);
  });

  it("prefixes a digest header and concatenates blocks with dividers when N>1", () => {
    const result = composeCoalescedSlackMessage([
      {
        event: makeEvent({ id: "e1" }),
        message: makeMessage({
          text: "results failed to update",
          blocks: [
            { type: "section", text: { type: "mrkdwn", text: "fail body" } },
          ],
        }),
      },
      {
        event: makeEvent({ id: "e2" }),
        message: makeMessage({
          text: "updated by automation",
          blocks: [
            { type: "section", text: { type: "mrkdwn", text: "update body" } },
          ],
        }),
      },
    ]);

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.blocks[0]).toEqual({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "*2 updates on Checkout CTA*",
        },
      ],
    });

    // Divider sits between event blocks (not before the first one).
    const dividerIndices = result.blocks
      .map((b, i) => (b.type === "divider" ? i : -1))
      .filter((i) => i >= 0);
    expect(dividerIndices).toHaveLength(1);

    const bodyTexts = result.blocks
      .filter(
        (b): b is Extract<typeof b, { type: "section" }> =>
          b.type === "section",
      )
      .map((b) => (b.text && "text" in b.text ? b.text.text : ""));
    expect(bodyTexts).toEqual(["fail body", "update body"]);

    expect(result.text).toContain("2 updates on Checkout CTA");
    expect(result.text).toContain("results failed to update");
    expect(result.text).toContain("updated by automation");
  });

  it("caps visible events at 5 and appends a '+N more' footer", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      event: makeEvent({ id: `e${i}` }),
      message: makeMessage({
        text: `change ${i}`,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `body ${i}` },
          },
        ],
      }),
    }));

    const result = composeCoalescedSlackMessage(items);
    expect(result).not.toBeNull();
    if (!result) return;

    const sectionBodies = result.blocks
      .filter(
        (b): b is Extract<typeof b, { type: "section" }> =>
          b.type === "section",
      )
      .map((b) => (b.text && "text" in b.text ? b.text.text : ""));
    // 5 visible bodies (cap), 2 hidden.
    expect(sectionBodies).toEqual([
      "body 0",
      "body 1",
      "body 2",
      "body 3",
      "body 4",
    ]);

    const footer = result.blocks[result.blocks.length - 1];
    expect(footer.type).toBe("context");
    if (footer.type === "context") {
      const element = footer.elements[0] as { type: string; text: string };
      expect(element.text).toContain("+2 more changes");
    }
  });

  it("uses the object id as the label when the rendered data has no name", () => {
    const eventWithIdOnly = makeEvent({
      data: {
        data: { object: { id: "exp_xyz" } },
      } as unknown as EventInterface["data"],
    });

    const result = composeCoalescedSlackMessage([
      { event: eventWithIdOnly, message: makeMessage() },
      { event: eventWithIdOnly, message: makeMessage() },
    ]);

    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.text).toContain("exp_xyz");
  });

  it("falls back to the event objectId field when payload has no embedded object", () => {
    const sparseEvent = makeEvent({
      data: {} as unknown as EventInterface["data"],
      objectId: "exp_fallback",
    });

    const result = composeCoalescedSlackMessage([
      { event: sparseEvent, message: makeMessage() },
      { event: sparseEvent, message: makeMessage() },
    ]);

    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.text).toContain("exp_fallback");
  });
});
