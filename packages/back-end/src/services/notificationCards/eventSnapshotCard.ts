import type { NotificationEvent } from "shared/types/events/notification-events";
import { srm } from "shared/validators";
import type { ExperimentCardData } from "./cardImages";

// Cards are built from the event payload alone so a delayed notification can
// never show experiment state that contradicts the alert it accompanies.
export function buildEventSnapshotCard(
  event: NotificationEvent,
): ExperimentCardData | null {
  if (
    event.event === "experiment.warning" &&
    event.data.object.type === "srm"
  ) {
    const parsed = srm.safeParse(event.data.object);
    if (!parsed.success) return null;
    return {
      state: "warning",
      event: "warning",
      name: parsed.data.experimentName,
      key: parsed.data.experimentId,
      goal: "",
      variants: [],
      rows: [],
      summary: [
        "Sample ratio mismatch detected.",
        `SRM threshold: ${parsed.data.threshold}`,
      ],
    };
  }
  return null;
}
