import type { NotificationEvent } from "shared/types/events/notification-events";

const base = {
  experimentId: "exp-checkout",
  experimentName: "Checkout redesign",
};
const significance = {
  ...base,
  variationId: "v-express",
  variationName: "Express checkout",
  metricId: "metric-revenue",
  metricName: "Revenue per visitor",
  statsEngine: "frequentist",
  criticalValue: 0.012,
  winning: true,
  snapshotId: "snap-review",
  differenceType: "relative",
  uplift: 0.085,
};

export const eventSnapshotCardSamples: {
  name: string;
  event: NotificationEvent;
}[] = [
  {
    name: "started",
    event: {
      event: "experiment.started",
      data: {
        object: {
          ...base,
          type: "started",
          variationCount: 3,
          phaseName: "Main phase",
        },
      },
    } as NotificationEvent,
  },
  {
    name: "stopped",
    event: {
      event: "experiment.stopped",
      data: {
        object: {
          ...base,
          type: "stopped",
          results: "inconclusive",
          enableTemporaryRollout: true,
          releasedVariationName: "Original checkout",
          reason:
            "Pause while investigating instrumentation. No winner was selected; the original checkout remains active during the investigation.",
        },
      },
    } as NotificationEvent,
  },
  {
    name: "significance",
    event: {
      event: "experiment.info.significance",
      data: { object: significance },
    } as NotificationEvent,
  },
  {
    name: "inverse-regression",
    event: {
      event: "experiment.info.significance",
      data: {
        object: {
          ...significance,
          metricName: "Checkout error rate (lower is better)",
          metricId: "metric-errors",
          winning: false,
          uplift: 0.08,
        },
      },
    } as NotificationEvent,
  },
];
