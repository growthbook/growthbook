import { ReactNode } from "react";
import { datetime } from "shared/dates";
import { RevisionLog } from "shared/types/feature-revision";
import CommentCard from "@/components/Comments/CommentCard";
import MarkdownWithDiffRefs from "@/components/Reviews/DiffCommentMarkdown";
import {
  rowVisual,
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
    .map((l) => {
      let comment: string | undefined;
      try {
        comment = JSON.parse(l.value)?.comment;
      } catch {
        // not JSON
      }
      return {
        ...l,
        comment,
        retraction: retractions?.get(l) ?? null,
        isActiveVerdict: l === activeVerdict,
      };
    });
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
  const verdictColor =
    log.action === "Approved"
      ? "green"
      : log.action === "Requested Changes"
        ? "red"
        : null;
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
        verdictColor ? (
          <Avatar
            size="sm"
            color={verdictColor}
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
