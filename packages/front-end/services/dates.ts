export function formatShortAgo(dateOrTimestamp: Date | number): string {
  const ts =
    typeof dateOrTimestamp === "number"
      ? dateOrTimestamp
      : dateOrTimestamp.getTime();
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 1) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
