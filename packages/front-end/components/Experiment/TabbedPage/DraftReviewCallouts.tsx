import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
  LinkedFeaturePendingDraft,
} from "shared/types/experiment";
import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut, PiFlag } from "react-icons/pi";
import { draftApprovalSatisfied } from "@/components/Reviews/reviewAndPublishState";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import { draftInReview, draftReviewHref } from "./draftPicks";

type DraftInReview = {
  featureId: string;
  draft: LinkedFeaturePendingDraft;
  publishesAtStart: boolean;
};

function reviewSentence({ featureId, draft }: DraftInReview): ReactNode {
  const subject = (
    <>
      <strong style={{ whiteSpace: "nowrap" }}>
        <PiFlag style={{ verticalAlign: "-0.125em", marginRight: "0.2em" }} />
        {featureId}
      </strong>{" "}
      · <strong>Revision {draft.version}</strong>
    </>
  );
  if (draft.status === "changes-requested") {
    return <>Changes were requested on {subject}.</>;
  }
  if (draft.status === "approved") return <>{subject} is approved.</>;
  if (draftApprovalSatisfied(draft)) return <>{subject} is ready to publish.</>;
  if (draft.pendingApproval) return <>{subject} needs approval.</>;
  return <>{subject} is in review.</>;
}

function startSentence({ draft, publishesAtStart }: DraftInReview) {
  if (draft.status === "changes-requested") return null;
  if (draft.status === "approved" || draftApprovalSatisfied(draft)) {
    return publishesAtStart
      ? "It publishes when the experiment starts, or you can publish it now."
      : draft.status === "approved"
        ? "It's ready to publish."
        : null;
  }
  return draft.pendingApproval && publishesAtStart
    ? "Once approved, it publishes when the experiment starts."
    : null;
}

/**
 * The linked flags' drafts someone still has to review or publish, in one
 * callout. A draft that publishes on its own when the experiment starts needs
 * nothing until then, unless it's waiting on review.
 */
export default function DraftReviewCallouts({
  experiment,
  linkedFeatures,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
}) {
  const inReview = linkedFeatures.flatMap(
    ({ feature, pendingDraft, otherPendingDrafts }): DraftInReview[] => {
      const drafts = pendingDraft
        ? [pendingDraft, ...(otherPendingDrafts ?? [])]
        : [];
      return drafts.flatMap((draft) => {
        // Only the newest draft that changes the rule publishes at start.
        const publishesAtStart =
          experiment.status === "draft" && draft.version === drafts[0].version;
        const waiting =
          draftInReview(draft) || (draft.hasChanges && !publishesAtStart);
        return waiting
          ? [{ featureId: feature.id, draft, publishesAtStart }]
          : [];
      });
    },
  );
  if (!inReview.length) return null;

  if (inReview.length === 1) {
    const [only] = inReview;
    const start = startSentence(only);
    return (
      <Callout
        status="info"
        contentAlign="center"
        mb="4"
        action={
          <LinkButton
            href={draftReviewHref(only.featureId, only.draft.version)}
            external
            variant="outline"
            size="sm"
            icon={<PiArrowSquareOut />}
            iconPosition="right"
          >
            Review & Publish
          </LinkButton>
        }
      >
        {reviewSentence(only)}
        {start ? ` ${start}` : null}
      </Callout>
    );
  }

  // TODO: Replace with a single CTA once multi-entity / multi-draft releases are available in-app
  return (
    <Callout status="info" mb="4">
      <Box mb="2">
        {inReview.length} Feature Flag drafts aren&apos;t published yet.
      </Box>
      <Flex direction="column" gap="1">
        {inReview.map((item) => (
          <Flex
            key={`${item.featureId}:${item.draft.version}`}
            align="baseline"
            justify="between"
            gap="4"
          >
            <Text size="sm">
              {reviewSentence(item)}
              {item.publishesAtStart ? (
                <Text color="text-low"> Publishes at start.</Text>
              ) : null}
            </Text>
            <Text size="sm" whiteSpace="nowrap">
              <Link
                href={draftReviewHref(item.featureId, item.draft.version)}
                external
              >
                Review & Publish
                <PiArrowSquareOut style={{ marginLeft: "var(--space-1)" }} />
              </Link>
            </Text>
          </Flex>
        ))}
      </Flex>
    </Callout>
  );
}
