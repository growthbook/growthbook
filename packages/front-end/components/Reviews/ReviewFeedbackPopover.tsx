import { ReactNode, useMemo } from "react";
import { Flex, ScrollArea } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { RevisionLog } from "shared/types/feature-revision";
import useApi from "@/hooks/useApi";
import ReviewCommentCard, {
  reviewCommentsFromLog,
} from "@/components/Reviews/ReviewCommentCard";
import { scanVerdictRetractions } from "@/components/Reviews/RevisionTimeline";
import { useUser } from "@/services/UserContext";
import { Popover } from "@/ui/Popover";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";

// How many entries the popover shows before pointing at the full review.
const MAX_REVIEWS = 5;

// Feedback only; requests and recalls are process, not something to read.
const FEEDBACK_ACTIONS = new Set(["Comment", "Approved", "Requested Changes"]);

/** Hover a draft's status to read the feedback on it, newest first. */
export default function ReviewFeedbackPopover({
  featureId,
  version,
  reviewHref,
  children,
}: {
  featureId: string;
  version: number;
  reviewHref: string;
  children: ReactNode;
}) {
  const { userId } = useUser();
  const { data } = useApi<{ log: RevisionLog[] }>(
    `/feature/${featureId}/${version}/log`,
  );
  const comments = useMemo(() => {
    const sorted = [...(data?.log ?? [])].sort((a, b) =>
      String(a.timestamp).localeCompare(String(b.timestamp)),
    );
    return reviewCommentsFromLog(sorted, scanVerdictRetractions(sorted, userId))
      .filter((l) => FEEDBACK_ACTIONS.has(l.action))
      .reverse();
  }, [data, userId]);

  return (
    <Popover
      openOnHover
      side="top"
      align="start"
      avoidCollisions={false}
      // The scroll lives inside: overflow on the content box clips its arrow.
      contentStyle={{ width: 380, padding: "15px 20px 10px" }}
      // The trigger takes the hover handlers, so it must be a plain element.
      trigger={<span style={{ display: "inline-flex" }}>{children}</span>}
      content={
        <Flex direction="column" gap="2">
          {/* Out to the box's right edge, and drawn only while in use,
              whatever the OS scrollbar setting. */}
          <ScrollArea
            type="hover"
            scrollbars="vertical"
            style={{ maxHeight: 340, marginRight: -20, width: "auto" }}
          >
            <Flex direction="column" gap="3" style={{ paddingRight: 20 }}>
              {!data ? (
                <Text size="sm" color="text-low">
                  Loading reviews…
                </Text>
              ) : !comments.length ? (
                <Text size="sm" color="text-low">
                  No reviews yet.
                </Text>
              ) : (
                comments
                  .slice(0, MAX_REVIEWS)
                  .map((l, i) => <ReviewCommentCard key={l.id ?? i} log={l} />)
              )}
            </Flex>
          </ScrollArea>
          <Flex justify="end">
            <LinkButton
              href={reviewHref}
              external
              variant="outline"
              size="sm"
              icon={<PiArrowSquareOut />}
              iconPosition="right"
            >
              {comments.length > MAX_REVIEWS
                ? `See all ${comments.length} in the review`
                : "Open review"}
            </LinkButton>
          </Flex>
        </Flex>
      }
    />
  );
}
