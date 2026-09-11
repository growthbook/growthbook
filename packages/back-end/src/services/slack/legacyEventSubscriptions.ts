// The original Slack prototype split stopped outcomes into separate event names.
// The current lifecycle event includes the outcome in its payload instead.
export function normalizeLegacySlackEvent(event: string): string {
  return event === "experiment.stopped.shipped" ||
    event === "experiment.stopped.rolledback"
    ? "experiment.stopped"
    : event;
}
