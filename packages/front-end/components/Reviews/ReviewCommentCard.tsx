import { ReactNode } from "react";
import { datetime } from "shared/dates";
import { RevisionLog } from "shared/types/feature-revision";
import CommentCard from "@/components/Comments/CommentCard";
import MarkdownWithDiffRefs from "@/components/Reviews/DiffCommentMarkdown";
import {
  logComment,
  rowVisual,
  verdictColor,
  VerdictRetraction,
  VerdictTags,
} from "@/components/Reviews/RevisionTimeline";
import Avatar from "@/ui/Avatar";

export type ReviewComment = RevisionLog & {
  comment?: string;
  retraction: VerdictRetraction | null;
  /** The viewer's own standing verdict, the one they can retract. */
  isActiveVerdict: boolean;
};

const CONVERSATION_ACTIONS = [
  "Comment",
  "Review Requested",
  "Approved",
  "Requested Changes",
];

/** The review conversation in a revision's log, oldest first, with each entry's comment. */
export function reviewCommentsFromLog(
  sortedLog: RevisionLog[],
  retractions?: WeakMap<RevisionLog, VerdictRetraction>,
  activeVerdict?: RevisionLog | null,
): ReviewComment[] {
  return sortedLog
    .filter((l) => CONVERSATION_ACTIONS.includes(l.action))
    .map((l) => ({
      ...l,
      comment: logComment(l),
      retraction: retractions?.get(l) ?? null,
      isActiveVerdict: l === activeVerdict,
    }));
}

/** One entry of a review conversation, as the review panel shows it. */
export default function ReviewCommentCard({
  log,
  uncoveredReason,
  actions,
  body,
}: {
  log: ReviewComment;
  /** Set when an approval stands but can't sanction the publish. */
  uncoveredReason?: string;
  actions?: ReactNode;
  /** Replaces the rendered comment, e.g. with an editor. */
  body?: ReactNode;
}) {
  const visual = rowVisual(log.action);
  const verdict = verdictColor(log.action);
  return (
    <CommentCard
      user={log.user}
      metadata={`${visual.verb}: ${datetime(log.timestamp)}`}
      metadataExtra={
        <VerdictTags
          uncoveredReason={uncoveredReason}
          retraction={log.retraction}
        />
      }
      stripeColor={visual.color}
      leading={
        verdict ? (
          <Avatar
            size="sm"
            color={verdict}
            variant={uncoveredReason ? "soft" : "solid"}
            ring={!!uncoveredReason}
          >
            <>{visual.icon}</>
          </Avatar>
        ) : undefined
      }
      avatarSize="sm"
      compact
      actions={actions}
      body={
        body ??
        (log.comment ? (
          <MarkdownWithDiffRefs className="speech-bubble">
            {log.comment}
          </MarkdownWithDiffRefs>
        ) : undefined)
      }
    />
  );
}
