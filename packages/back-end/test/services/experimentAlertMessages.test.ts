import type { NotificationEvent } from "shared/types/events/notification-events";
import type { KnownBlock } from "@slack/types";
import { buildExperimentAlertMessageForEvent } from "back-end/src/events/handlers/slack/experimentAlerts";
import { getSlackMessageForNotificationEvent } from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import { buildNotificationCard } from "back-end/src/services/notificationCards/renderNotificationCard";
import { notificationCardSamples } from "./notificationCard.fixtures";

// Every text message follows the card layout: a title section, an optional
// fields section, any extra blocks, and the footer last.
const sectionText = (block: KnownBlock | undefined): string =>
  block && "text" in block && block.text ? block.text.text : "";
const footerText = (blocks: KnownBlock[]): string => {
  const footer = blocks[blocks.length - 1];
  const element = footer?.type === "context" ? footer.elements[0] : undefined;
  return element && "text" in element ? element.text : "";
};

const experimentEvent = (
  event: string,
  object: Record<string, unknown>,
): NotificationEvent =>
  ({
    event,
    data: {
      object: { experimentId: "exp-1", experimentName: "Checkout", ...object },
    },
  }) as NotificationEvent;

describe("experiment alert messages", () => {
  it("escapes user text so names cannot inject Slack mentions or links", () => {
    const event = experimentEvent("experiment.status.started", {
      type: "started",
      experimentName: "<!channel> & <http://x|y>",
    }) as Extract<NotificationEvent, { event: "experiment.status.started" }>;
    const { blocks } = buildExperimentAlertMessageForEvent(event);
    expect(sectionText(blocks[0])).toBe(
      "*&lt;!channel&gt; &amp; &lt;http://x|y&gt;* - Experiment Started",
    );
    expect(JSON.stringify(blocks)).not.toContain("<!channel>");
  });

  it("lays out title, fields, and footer like the card", async () => {
    const message = await getSlackMessageForNotificationEvent(
      experimentEvent("experiment.status.endingSoon", {
        type: "ending-soon",
        endsAt: "2026-09-14T00:00:00Z",
        daysRemaining: 3,
        experimentId: "exp/1",
      }),
      "event_test",
    );
    expect(message?.blocks.map((b) => b.type)).toEqual([
      "section",
      "section",
      "context",
    ]);
    expect(sectionText(message?.blocks[0])).toBe("*Checkout* - Ending Soon");
    expect(sectionText(message?.blocks[1])).toBe(
      "*Scheduled end*\n2026-09-14T00:00:00Z",
    );
    // No button: the footer's link is the way to the experiment.
    expect(footerText(message?.blocks ?? [])).toMatch(
      /^<[^|]+\/experiment\/exp%2F1\|Checkout>$/,
    );
    expect(message?.text).toBe(
      "Checkout - Ending Soon. Scheduled end: 2026-09-14T00:00:00Z.",
    );
  });

  it("uses the same immutable start details for Slack text and image cards", async () => {
    const sample = notificationCardSamples.find((s) => s.name === "started");
    if (!sample) throw new Error("Missing started sample");
    const message = await getSlackMessageForNotificationEvent(
      sample.event,
      "event_test",
    );
    const card = buildNotificationCard(sample.event)?.data;
    const cardFields =
      card?.sections.flatMap((s) => (s.kind === "fields" ? s.fields : [])) ??
      [];
    expect(cardFields.map((f) => f.label)).toEqual([
      "Goal metrics",
      "Linked changes",
    ]);
    expect(sectionText(message?.blocks[1])).toBe(
      cardFields.map((f) => `*${f.label}*\n${f.value}`).join("\n\n"),
    );
    expect(message?.text).toBe(
      "Checkout redesign - Experiment Started. Goal metrics: Checkout conversion, Revenue per visitor, Add to cart rate (+2 more). Linked changes: 2 Feature Flags, 1 Visual Editor change, 1 URL redirect.",
    );
  });

  it("lists failing guardrails under their own header", async () => {
    const message = await getSlackMessageForNotificationEvent(
      experimentEvent("experiment.guardrailFailed", {
        type: "guardrail-failed",
        failedMetrics: [
          { id: "g1", name: "Revenue", variationName: "Test A" },
          { id: "g2", name: "Errors", variationName: "Test B" },
        ],
      }),
      "event_test",
    );
    expect(sectionText(message?.blocks[0])).toBe(
      "*Checkout* - Guardrail Failed",
    );
    expect(sectionText(message?.blocks[1])).toBe(
      "*Failing guardrails*\nRevenue (Test A), Errors (Test B)",
    );
  });

  it.each([
    ["query", "database queries failed"],
    ["analysis", "analysis failed"],
    ["no-queries", "no queries were generated"],
    ["unknown", "an unexpected error occurred"],
  ])(
    "describes an update failure caused by %s without raw warehouse errors",
    async (cause, detail) => {
      const message = await getSlackMessageForNotificationEvent(
        experimentEvent("experiment.warning", {
          type: "update-failed",
          cause,
          errorMessage: "secret SQL",
        }),
        "event_test",
      );
      expect(message?.text).toBe(
        `Checkout - Update Failed. Details: Results failed to update because ${detail}.`,
      );
      expect(JSON.stringify(message)).not.toContain("secret SQL");
    },
  );

  it.each([
    [true, "Automatic updates were turned off after a failed refresh."],
    [
      false,
      "Automatic updates could not be turned off after a failed refresh and remain on.",
    ],
  ])(
    "describes auto-updates being turned off (success: %s)",
    async (success, detail) => {
      const message = await getSlackMessageForNotificationEvent(
        experimentEvent("experiment.warning", { type: "auto-update", success }),
        "event_test",
      );
      expect(message?.text).toBe(
        `Checkout - Automatic Updates. Details: ${detail}`,
      );
    },
  );

  it("tells the same stop story as the card: conclusion, rollout, goal metric", async () => {
    const sample = notificationCardSamples.find(
      (s) => s.name === "stopped-winner",
    );
    if (!sample) throw new Error("Missing stopped-winner sample");
    const message = await getSlackMessageForNotificationEvent(
      sample.event,
      "event_test",
    );
    expect(sectionText(message?.blocks[0])).toBe(
      "*Checkout redesign* - Experiment Stopped - Winner",
    );
    // Card italics become Slack italics; the rest stays literal.
    expect(sectionText(message?.blocks[1])).toBe(
      [
        "*Conclusion*\n_One-page checkout_ won. One-page checkout lifted conversion with no revenue regression. Shipping to 100%.",
        "*Temporary rollout*\n_One-page checkout_",
        "*Goal metric*\nCheckout conversion: +6.1% (Chance to win: 99.1%)",
      ].join("\n\n"),
    );
    expect(message?.text).toBe(
      "Checkout redesign - Experiment Stopped - Winner. Conclusion: One-page checkout won. One-page checkout lifted conversion with no revenue regression. Shipping to 100%. Temporary rollout: One-page checkout. Goal metric: Checkout conversion: +6.1% (Chance to win: 99.1%).",
    );
  });

  it("describes an SRM alert from its evidence with the shared shape", async () => {
    const sample = notificationCardSamples.find((s) => s.name === "srm");
    if (!sample) throw new Error("Missing srm sample");
    const message = await getSlackMessageForNotificationEvent(
      sample.event,
      "event_test",
    );
    expect(sectionText(message?.blocks[0])).toBe(
      "*Checkout redesign* - Health Alert - SRM Detected",
    );
    // "<0.001" is escaped for mrkdwn; Slack renders it back as "<".
    expect(sectionText(message?.blocks[1])).toBe(
      [
        "*Traffic split*\nTraffic isn't splitting as configured (p-value &lt;0.001, threshold 0.001).",
        "*Variations*\nControl: 6,213 units (62.1%, expected 50%)\nOne-page checkout: 3,787 units (37.9%, expected 50%)",
      ].join("\n\n"),
    );
    // Text deliveries carry the run so far in the footer; the SRM payload
    // records both units and days.
    expect(footerText(message?.blocks ?? [])).toMatch(
      /^<[^|]+\/experiment\/exp-checkout\|Checkout redesign> \| 12 days \| 10,000 users$/,
    );
  });

  it("puts the experiment's days, units, and owner in the footer of a stop", async () => {
    const message = await getSlackMessageForNotificationEvent(
      experimentEvent("experiment.status.stopped", {
        type: "stopped",
        ownerEmail: "owner@example.com",
        enableTemporaryRollout: false,
        totalUsers: 67970,
        durationDays: 314,
      }),
      "event_test",
    );
    expect(footerText(message?.blocks ?? [])).toMatch(
      /\|Checkout> \| 314 days \| 67,970 users \| Owner: owner@example.com$/,
    );
    expect(sectionText(message?.blocks[1])).toBe(
      "*Result*\nStopped without a recorded outcome",
    );
  });

  it("carries the run so far in the footer of an ending-soon reminder", async () => {
    const message = await getSlackMessageForNotificationEvent(
      experimentEvent("experiment.status.endingSoon", {
        type: "ending-soon",
        endsAt: "2026-09-14T00:00:00Z",
        daysRemaining: 3,
        durationDays: 11,
        totalUsers: 48200,
        ownerEmail: "owner@example.com",
      }),
      "event_test",
    );
    expect(footerText(message?.blocks ?? [])).toMatch(
      /\|Checkout> \| 11 days \| 48,200 users \| Owner: owner@example.com$/,
    );
  });

  it("uses the stale reminder's days running as the footer duration", async () => {
    const message = await getSlackMessageForNotificationEvent(
      experimentEvent("experiment.status.stale", {
        type: "stale",
        daysRunning: 95,
        totalUsers: 120000,
        reason: "Long running.",
      }),
      "event_test",
    );
    expect(sectionText(message?.blocks[0])).toBe("*Checkout* - Stale");
    expect(footerText(message?.blocks ?? [])).toMatch(
      /\|Checkout> \| 95 days \| 120,000 users$/,
    );
  });

  it("names only the experiment and owner when a start records no counts", async () => {
    const message = await getSlackMessageForNotificationEvent(
      experimentEvent("experiment.status.started", {
        type: "started",
        ownerEmail: "owner@example.com",
      }),
      "event_test",
    );
    expect(footerText(message?.blocks ?? [])).toMatch(
      /\|Checkout> \| Owner: owner@example.com$/,
    );
  });
});
