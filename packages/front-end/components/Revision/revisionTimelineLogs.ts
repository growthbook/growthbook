import { Revision } from "shared/enterprise";
import { RevisionLog } from "shared/types/feature-revision";

// Maps a generic Revision's baked reviews[] + activityLog[] into the shared
// <RevisionTimeline>'s RevisionLog shape (the source-of-truth feature log
// format). Reviews become Comment / Approved / Requested Changes entries;
// lifecycle activity maps to the equivalent feature action verbs. Content
// edits map to "update" (collapsed under the Conversation tab). Activity
// actions already represented by reviews[] are dropped to avoid double-counting.

type ResolveUser = (id: string) => { name?: string; email?: string };

const ACTIVITY_ACTION_MAP: Record<string, string> = {
  created: "new revision",
  updated: "update",
  merged: "publish",
  discarded: "discard",
  reopened: "reopen",
  "scheduled-publish": "schedule publish",
  "scheduled-publish-updated": "update scheduled publish",
  "scheduled-publish-canceled": "cancel scheduled publish",
};

// Activity actions that duplicate entries already surfaced from reviews[].
const REVIEW_DUPLICATE_ACTIONS = new Set([
  "reviewed",
  "commented",
  "approved",
  "requested-changes",
]);

export function revisionTimelineLogs(
  revision: Revision,
  resolveUser: ResolveUser,
): RevisionLog[] {
  const toUser = (id: string): RevisionLog["user"] => {
    const u = resolveUser(id);
    return {
      type: "dashboard",
      id,
      name: u.name ?? "",
      email: u.email ?? "",
    };
  };
  // The shared timeline sorts by ISO timestamp string, so emit ISO strings
  // (the runtime shape feature log data also uses) rather than Date objects.
  const iso = (d: Date | string): Date =>
    new Date(d).toISOString() as unknown as Date;

  const logs: RevisionLog[] = [];

  for (const r of revision.reviews) {
    const action =
      r.decision === "approve"
        ? "Approved"
        : r.decision === "request-changes"
          ? "Requested Changes"
          : "Comment";
    logs.push({
      id: r.id,
      user: toUser(r.userId),
      timestamp: iso(r.dateCreated),
      action,
      subject: "",
      value: r.comment ? JSON.stringify({ comment: r.comment }) : "",
    });
  }

  for (const a of revision.activityLog) {
    if (REVIEW_DUPLICATE_ACTIONS.has(a.action)) continue;
    const action = ACTIVITY_ACTION_MAP[a.action];
    if (!action) continue;
    logs.push({
      id: a.id,
      user: toUser(a.userId),
      timestamp: iso(a.dateCreated),
      action,
      subject: "",
      // No raw-JSON Details for saved-group activity (diffs out of scope).
      value: "",
    });
  }

  return logs;
}
