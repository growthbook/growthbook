import { getWildcardPatternsForEvent } from "shared/validators";

const renamedEvents: Record<string, string> = {
  "experiment.started": "experiment.status.started",
  "experiment.stopped": "experiment.status.stopped",
  "experiment.endingSoon": "experiment.status.endingSoon",
  "experiment.stale": "experiment.status.stale",
  "experiment.stopped.shipped": "experiment.status.stopped",
  "experiment.stopped.rolledback": "experiment.status.stopped",
  "experiment.health.queryFailed": "experiment.health.updateFailure",
  "experiment.health.queryFailure": "experiment.health.updateFailure",
  "experiment.health.guardrailFailed": "experiment.metric.guardrailFailure",
};

export function normalizeLegacySlackEvent(event: string): string {
  return renamedEvents[event] ?? event;
}

export function getSlackEventSubscriptionNames(event: string): string[] {
  const names = [event, ...getWildcardPatternsForEvent(event)];
  for (const [previous, current] of Object.entries(renamedEvents)) {
    if (current === event) names.push(previous);
  }
  if (
    event === "experiment.status.started" ||
    event === "experiment.status.stopped"
  ) {
    names.push("experiment.status.changed");
  }
  // Existing warning subscriptions continue receiving these alerts, once per event.
  if (
    event === "experiment.health.srm" ||
    event === "experiment.health.multipleExposures"
  ) {
    names.push("experiment.warning");
  }
  return names;
}
