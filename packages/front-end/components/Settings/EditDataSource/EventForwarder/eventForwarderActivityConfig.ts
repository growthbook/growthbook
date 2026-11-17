// Why a zero total: stopped forwarding, not missing SDK tracking.
export function getEventForwarderNoEventsMessage({
  isPaused,
  isOverLimit,
}: {
  isPaused: boolean;
  isOverLimit: boolean;
}): string {
  if (isPaused) return "Forwarding is paused, so no new events are arriving.";
  if (isOverLimit) {
    return "The monthly event limit has been reached, so no new events are arriving.";
  }
  return "No events were forwarded during this period.";
}
