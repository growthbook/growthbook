import { datetime } from "shared/dates";

// A comment's time, abbreviated: "Just now" under a minute, "15 min. ago"
// under an hour, "3 hr. ago" under a day, then the full date and time once a
// day has passed. Used by the compact comment layout (the experiment Setup
// page's rail).
export function formatCommentTime(
  date: string | Date,
  now: Date = new Date(),
): string {
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  // Future or unparseable dates fall through to the full date.
  if (seconds >= 0 && seconds < 60) return "Just now";
  if (seconds >= 60 && seconds < 3600) {
    return `${Math.floor(seconds / 60)} min. ago`;
  }
  if (seconds >= 3600 && seconds < 86400) {
    return `${Math.floor(seconds / 3600)} hr. ago`;
  }
  return datetime(then);
}
