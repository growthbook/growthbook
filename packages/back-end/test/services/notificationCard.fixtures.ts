import type { NotificationEvent } from "shared/types/events/notification-events";

const base = {
  experimentId: "exp-checkout",
  experimentName: "Checkout redesign",
};

export const notificationCardSamples: {
  name: string;
  event: NotificationEvent;
}[] = [
  {
    name: "started",
    event: {
      event: "experiment.status.started",
      data: {
        object: {
          ...base,
          type: "started",
          linkedFeatureCount: 2,
          visualChangesetCount: 1,
          urlRedirectCount: 1,
          phaseName: "Main phase",
          goalMetricNames: [
            "Checkout conversion",
            "Revenue per visitor",
            "Add to cart rate",
            "Cart abandonment",
            "Support tickets",
          ],
        },
      },
    } as NotificationEvent,
  },
  {
    name: "stopped",
    event: {
      event: "experiment.status.stopped",
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
    name: "stopped-winner",
    event: {
      event: "experiment.status.stopped",
      data: {
        object: {
          ...base,
          type: "stopped",
          results: "won",
          enableTemporaryRollout: true,
          releasedVariationName: "One-page checkout",
          reason:
            "One-page checkout lifted conversion with no revenue regression. Shipping to 100%.",
          winningVariationName: "One-page checkout",
          winningVariationIndex: 1,
          totalUsers: 162400,
          durationDays: 26,
          goalMetric: {
            metricId: "met_checkout_conversion",
            metricName: "Checkout conversion",
            snapshotId: "snp_final",
            statsEngine: "bayesian",
            differenceType: "relative",
            control: {
              variationId: "v0",
              variationName: "Control",
              users: 54300,
              value: 0.051,
              formattedValue: "5.10%",
            },
            variations: [
              {
                variationId: "v1",
                variationName: "One-page checkout",
                variationIndex: 1,
                users: 54300,
                value: 0.0541,
                formattedValue: "5.41%",
                uplift: 0.061,
                upliftStddev: 0.012,
                ci: [0.038, 0.084],
                chanceToWin: 0.991,
              },
              {
                variationId: "v2",
                variationName: "Express pay",
                variationIndex: 2,
                users: 53800,
                value: 0.0529,
                formattedValue: "5.29%",
                uplift: 0.038,
                upliftStddev: 0.015,
                ci: [0.009, 0.067],
                chanceToWin: 0.91,
              },
            ],
          },
        },
      },
    } as NotificationEvent,
  },
  {
    name: "stopped-lost-frequentist",
    event: {
      event: "experiment.status.stopped",
      data: {
        object: {
          ...base,
          type: "stopped",
          results: "lost",
          enableTemporaryRollout: false,
          reason: "Conversion dropped significantly. Rolling back to control.",
          totalUsers: 98200,
          durationDays: 14,
          goalMetric: {
            metricId: "met_checkout_conversion",
            metricName: "Checkout conversion",
            snapshotId: "snp_final",
            statsEngine: "frequentist",
            differenceType: "relative",
            control: {
              variationId: "v0",
              variationName: "Control",
              users: 49100,
              value: 0.051,
              formattedValue: "5.10%",
            },
            variations: [
              {
                variationId: "v1",
                variationName: "Two-step checkout",
                variationIndex: 1,
                users: 49100,
                value: 0.0471,
                formattedValue: "4.71%",
                uplift: -0.076,
                upliftStddev: 0.018,
                ci: [-0.111, -0.041],
                pValue: 0.0004,
              },
            ],
          },
        },
      },
    } as NotificationEvent,
  },
  {
    name: "srm (legacy payload)",
    event: {
      event: "experiment.warning",
      data: { object: { ...base, type: "srm", threshold: 0.001 } },
    } as NotificationEvent,
  },
  {
    name: "srm",
    event: {
      event: "experiment.warning",
      data: {
        object: {
          ...base,
          type: "srm",
          threshold: 0.001,
          pValue: 0.00042,
          durationDays: 12,
          variations: [
            { name: "Control", users: 6213, weight: 0.5 },
            { name: "One-page checkout", users: 3787, weight: 0.5 },
          ],
        },
      },
    } as NotificationEvent,
  },
];
