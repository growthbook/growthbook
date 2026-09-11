import type { NotificationEvent } from "shared/types/events/notification-events";

const base = {
  experimentId: "exp-checkout",
  experimentName: "Checkout redesign",
};
export const eventSnapshotCardSamples: {
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
    name: "srm",
    event: {
      event: "experiment.warning",
      data: { object: { ...base, type: "srm", threshold: 0.001 } },
    } as NotificationEvent,
  },
];
