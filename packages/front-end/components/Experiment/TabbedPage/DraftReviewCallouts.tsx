import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
  LinkedFeaturePendingDraft,
} from "shared/types/experiment";
import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
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

type ReviewState =
  | "changes-requested"
  | "approved"
  | "ready"
  | "needs-approval"
  | "in-review";

function reviewState(draft: LinkedFeaturePendingDraft): ReviewState {
  if (draft.status === "changes-requested") return "changes-requested";
  if (draft.status === "approved") return "approved";
  if (draftApprovalSatisfied(draft)) return "ready";
  if (draft.pendingApproval) return "needs-approval";
  return "in-review";
}

const STATE_LABELS: Record<ReviewState, string> = {
  "changes-requested": "changes requested",
  approved: "approved",
  ready: "ready to publish",
  "needs-approval": "needs approval",
  "in-review": "in review",
};

const READY_STATES: ReviewState[] = ["approved", "ready"];

function listHeading(states: ReviewState[]): string {
  if (states.every((state) => state === "needs-approval")) {
    return "The following Feature Flags need approval:";
  }
  if (states.every((state) => READY_STATES.includes(state))) {
    return "The following Feature Flags are ready to publish:";
  }
  if (states.every((state) => !READY_STATES.includes(state))) {
    return "The following Feature Flags need review:";
  }
  return "The following Feature Flags need review or publishing:";
}

function reviewSentence({ featureId, draft }: DraftInReview): ReactNode {
  const subject = (
    <>
      Feature Flag{" "}
      <strong>
        {featureId} · Revision {draft.version}
      </strong>
    </>
  );
  switch (reviewState(draft)) {
    case "changes-requested":
      return <>Changes were requested on {subject}.</>;
    case "approved":
      return <>{subject} is approved.</>;
    case "ready":
      return <>{subject} is ready to publish.</>;
    case "needs-approval":
      return <>{subject} needs approval.</>;
    case "in-review":
      return <>{subject} is in review.</>;
  }
}

function startSentence({ draft, publishesAtStart }: DraftInReview) {
  const state = reviewState(draft);
  if (READY_STATES.includes(state)) {
    return publishesAtStart
      ? "It publishes when the experiment starts, or you can publish it now."
      : state === "approved"
        ? "It's ready to publish."
        : null;
  }
  return state === "needs-approval" && publishesAtStart
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

  const states = inReview.map(({ draft }) => reviewState(draft));
  const mixed = new Set(states).size > 1;

  // TODO: Replace with a single CTA once multi-entity / multi-draft releases are available in-app
  return (
    <Callout status="info" mb="4">
      <Box mb="2">{listHeading(states)}</Box>
      <Flex direction="column" gap="1">
        {inReview.map((item, i) => (
          <Flex
            key={`${item.featureId}:${item.draft.version}`}
            align="baseline"
            justify="between"
            gap="4"
          >
            <Text size="sm">
              <strong>
                {item.featureId} · Revision {item.draft.version}
              </strong>
              {mixed ? (
                <Text color="text-low"> · {STATE_LABELS[states[i]]}</Text>
              ) : null}
              {item.publishesAtStart ? (
                <Text color="text-low"> · publishes at start</Text>
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
