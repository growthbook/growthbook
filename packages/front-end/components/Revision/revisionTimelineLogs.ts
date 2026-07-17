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
  "review-requested": "Review Requested",
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

// Shape encoded into a "review-retracted" activity entry's description by the
// backend (RevisionModel.undoReview). The verdict is hard-deleted from
// reviews[], so the timeline reconstructs the original verdict card + a follow
// -up "Undo Review" marker from this so the shared retraction scan can render
// the muted "Retracted" badge (parity with feature soft-retain).
type RetractedVerdictPayload = {
  decision?: "approve" | "request-changes" | "comment";
  verdictDate?: string;
  comment?: string;
};

function parseRetractedVerdict(
  description: string | null | undefined,
): RetractedVerdictPayload | null {
  if (!description) return null;
  try {
    const parsed: unknown = JSON.parse(description);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { decision, verdictDate, comment } = parsed as Record<
      string,
      unknown
    >;
    return {
      decision:
        decision === "approve" ||
        decision === "request-changes" ||
        decision === "comment"
          ? decision
          : undefined,
      verdictDate: typeof verdictDate === "string" ? verdictDate : undefined,
      comment: typeof comment === "string" ? comment : undefined,
    };
  } catch {
    return null;
  }
}

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

    // A retracted verdict: hard-deleted from reviews[], so reconstruct the
    // original verdict row (so the shared scan can mark it "Retracted") plus
    // the "Undo Review" marker the scan looks for.
    if (a.action === "review-retracted") {
      const payload = parseRetractedVerdict(a.description);
      const verdictAction =
        payload?.decision === "approve"
          ? "Approved"
          : payload?.decision === "request-changes"
            ? "Requested Changes"
            : null;
      if (verdictAction && payload?.verdictDate) {
        // Rendered inline (no comment body) so it never offers an Edit/Delete
        // affordance pointing at a now-deleted reviews[] entry. The shared
        // retraction scan still pairs it with the "Undo Review" row below to
        // mark it "Retracted".
        logs.push({
          id: `${a.id}-verdict`,
          user: toUser(a.userId),
          timestamp: iso(payload.verdictDate),
          action: verdictAction,
          subject: "",
          value: "",
        });
      }
      logs.push({
        id: a.id,
        user: toUser(a.userId),
        timestamp: iso(a.dateCreated),
        action: "Undo Review",
        subject: "",
        value: "",
      });
      continue;
    }

    const action = ACTIVITY_ACTION_MAP[a.action];
    if (!action) continue;
    logs.push({
      id: a.id,
      user: toUser(a.userId),
      timestamp: iso(a.dateCreated),
      action,
      subject: "",
      // No "Details" JSON disclosure for generic (saved-group / constant)
      // activity entries. Features populate `value` with a clean domain
      // snapshot per entry (FeatureRevisionModel: the "new revision" log bakes
      // defaultValue/rules/environmentsEnabled/prerequisites at creation time),
      // but the generic model persists no equivalent:
      //   - "new revision" (created): only `proposedChangesSnapshot` (a raw
      //     JSON-Patch op array) + an entity-specific `targetSnapshot` baseline
      //     are available — i.e. the diff/raw-JSON the disclosure was scoped to
      //     exclude, not a domain payload.
      //   - "schedule publish": the backend writes a static
      //     description: "Scheduled publish" string (RevisionModel.armSchedule)
      //     and stores the date/lock targets/bypass flags only on the revision's
      //     current top-level fields, with no per-entry snapshot. Reconstructing
      //     them from current state would misattribute the latest schedule to
      //     superseded historical entries.
      // Populating `value` here would require backend changes (persist a
      // per-entry snapshot) rather than guesswork, so it's deferred.
      value: "",
    });
  }

  return logs;
}
