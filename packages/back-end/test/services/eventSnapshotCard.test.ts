import type { NotificationEvent } from "shared/types/events/notification-events";
import { buildEventSnapshotCard } from "back-end/src/services/notificationCards/eventSnapshotCard";

const significance = (
  overrides: Record<string, unknown> = {},
): NotificationEvent =>
  ({
    event: "experiment.info.significance",
    data: {
      object: {
        experimentId: "exp-1",
        experimentName: "Checkout",
        variationId: "v-2",
        variationName: "Express",
        metricId: "m-2",
        metricName: "Revenue",
        statsEngine: "frequentist",
        criticalValue: 0.012,
        winning: true,
        snapshotId: "snap-1",
        differenceType: "relative",
        uplift: 0.05,
        ...overrides,
      },
    },
  }) as NotificationEvent;

describe("immutable event cards", () => {
  it("uses the event's metric and variation, including frequentist terminology", () => {
    expect(buildEventSnapshotCard(significance())).toMatchObject({
      sentiment: "positive",
      name: "Checkout",
      goal: "Revenue",
      variants: ["Express"],
      rows: [],
      summary: [
        "Revenue · Express",
        "Relative change: 5.00%",
        "p-value: 0.0120",
        "Statistically significant improvement",
      ],
    });
  });
  it("uses Bayesian probability instead of calling it a p-value", () => {
    expect(
      buildEventSnapshotCard(
        significance({
          statsEngine: "bayesian",
          criticalValue: 0.02,
          winning: false,
          uplift: -0.08,
        }),
      )?.summary,
    ).toContain("Chance to beat baseline: 2.0%");
  });
  it("colors an inverse-metric improvement by outcome rather than uplift sign", () => {
    expect(
      buildEventSnapshotCard(significance({ winning: true, uplift: -0.08 }))
        ?.sentiment,
    ).toBe("positive");
    expect(
      buildEventSnapshotCard(significance({ winning: false, uplift: 0.08 }))
        ?.sentiment,
    ).toBe("negative");
  });
  it.each([
    { snapshotId: undefined },
    { uplift: undefined },
    { uplift: NaN },
    { differenceType: "absolute" },
    { differenceType: undefined },
  ])(
    "falls back for incomplete or unsupported immutable data %j",
    (overrides) => {
      expect(buildEventSnapshotCard(significance(overrides))).toBeNull();
    },
  );
  it("does not call an inconclusive stop a rollback or ship", () => {
    const event = {
      event: "experiment.stopped",
      data: {
        object: {
          type: "stopped",
          experimentId: "exp-1",
          experimentName: "Checkout",
          results: "inconclusive",
          enableTemporaryRollout: false,
        },
      },
    } as NotificationEvent;
    expect(buildEventSnapshotCard(event)).toMatchObject({
      event: "stopped",
      summary: ["Experiment stopped. Result: inconclusive."],
    });
  });
});
