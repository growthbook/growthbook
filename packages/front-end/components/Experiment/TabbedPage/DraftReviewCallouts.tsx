import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
  LinkedFeaturePendingDraft,
} from "shared/types/experiment";
import { startBypassCovers } from "shared/util";
import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
import { PiArrowSquareOut } from "react-icons/pi";
import StatusDot from "@/components/Experiment/StatusDot";
import {
  draftStatusDotColor,
  revisionStatusLabel,
} from "@/components/Reviews/RevisionStatusBadge";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import {
  DraftReviewState,
  draftNextStep,
  draftReviewHref,
  draftReviewState,
  flagDrafts,
  revisionHref,
} from "./draftPicks";

type DraftInReview = {
  featureId: string;
  draft: LinkedFeaturePendingDraft;
  publishesAtStart: boolean;
};

const READY_STATES: DraftReviewState[] = ["approved", "ready"];

function listHeading(states: DraftReviewState[]): ReactNode {
  const ready = states.filter((state) => READY_STATES.includes(state)).length;
  if (ready === states.length) {
    return <Trans>The following Feature Flags are ready to publish:</Trans>;
  }
  if (states.every((state) => state === "changes-requested")) {
    return (
      <Trans>Changes were requested on the following Feature Flags:</Trans>
    );
  }
  return ready ? (
    <Trans>The following Feature Flags need approval or publishing:</Trans>
  ) : (
    <Trans>The following Feature Flags need approval:</Trans>
  );
}

function DraftLink({
  featureId,
  draft,
}: Omit<DraftInReview, "publishesAtStart">) {
  const { i18n } = useLingui();
  const version = draft.version;
  return (
    <Link
      href={revisionHref(featureId, draft.version)}
      external
      color="violet"
      underline="hover"
    >
      <strong>{featureId}</strong>
      <Tooltip content={revisionStatusLabel(draft.status, i18n)}>
        <StatusDot
          inline
          color={draftStatusDotColor(draft.status)}
          style={{ marginLeft: "var(--space-2)" }}
        />
      </Tooltip>{" "}
      <Trans>Revision {version}</Trans>
    </Link>
  );
}

function reviewSentence({ featureId, draft }: DraftInReview): ReactNode {
  switch (draftReviewState(draft)) {
    case "changes-requested":
      return (
        <Trans>
          Changes were requested on Feature Flag{" "}
          <DraftLink featureId={featureId} draft={draft} />.
        </Trans>
      );
    case "approved":
      return (
        <Trans>
          Feature Flag <DraftLink featureId={featureId} draft={draft} /> is
          approved.
        </Trans>
      );
    case "ready":
      return (
        <Trans>
          Feature Flag <DraftLink featureId={featureId} draft={draft} /> is
          ready to publish.
        </Trans>
      );
    case "needs-approval":
      return (
        <Trans>
          Feature Flag <DraftLink featureId={featureId} draft={draft} /> needs
          approval.
        </Trans>
      );
    case "in-review":
      return (
        <Trans>
          Feature Flag <DraftLink featureId={featureId} draft={draft} /> is in
          review.
        </Trans>
      );
  }
}

function startSentence({ draft, publishesAtStart }: DraftInReview): ReactNode {
  const state = draftReviewState(draft);
  if (READY_STATES.includes(state)) {
    return publishesAtStart ? (
      <Trans>
        It publishes when the experiment starts, or you can publish it now.
      </Trans>
    ) : state === "approved" ? (
      <Trans>It&apos;s ready to publish.</Trans>
    ) : null;
  }
  return state === "needs-approval" && publishesAtStart ? (
    <Trans>Once approved, it publishes when the experiment starts.</Trans>
  ) : null;
}

// A draft that publishes when the experiment starts needs nothing until then,
// unless it's waiting on a review the start won't bypass.
export default function DraftReviewCallouts({
  experiment,
  linkedFeatures,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
}) {
  const { i18n } = useLingui();
  const inReview = linkedFeatures.flatMap((info): DraftInReview[] =>
    flagDrafts(info).flatMap((draft, i) => {
      // Only the newest draft that changes the rule publishes at start.
      const publishesAtStart = experiment.status === "draft" && i === 0;
      // Something blocking it is the flag's own notice to explain.
      if (
        publishesAtStart &&
        (draft.hasUnrelatedDraftChanges ||
          draft.hasMergeConflict ||
          info.cannotPublish)
      ) {
        return [];
      }
      const waiting =
        !startBypassCovers(experiment, info.feature.id, draft) &&
        (draftReviewState(draft) !== "ready" ||
          (draft.hasChanges && !publishesAtStart));
      return waiting
        ? [{ featureId: info.feature.id, draft, publishesAtStart }]
        : [];
    }),
  );
  if (!inReview.length) return null;

  if (inReview.length === 1) {
    const [only] = inReview;
    const start = startSentence(only);
    return (
      <Callout
        status="info"
        contentAlign="center"
        mt="2"
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
            {i18n._(draftNextStep(only.draft))}
          </LinkButton>
        }
      >
        {reviewSentence(only)}
        {start ? <> {start}</> : null}
      </Callout>
    );
  }

  const states = inReview.map(({ draft }) => draftReviewState(draft));

  // TODO: Replace with a single CTA once multi-entity / multi-draft releases are available in-app
  return (
    <Callout status="info" mt="2" mb="4">
      <Box mb="2">{listHeading(states)}</Box>
      <Flex direction="column" gap="1">
        {inReview.map((item) => (
          <Flex
            key={`${item.featureId}:${item.draft.version}`}
            align="center"
            justify="between"
            gap="4"
          >
            <Flex align="center" gap="3" wrap="wrap">
              <Text>
                <DraftLink featureId={item.featureId} draft={item.draft} />
              </Text>
              {item.publishesAtStart ? (
                <Text color="text-low">
                  <Trans>Publishes at start</Trans>
                </Text>
              ) : null}
            </Flex>
            <Text whiteSpace="nowrap">
              <Link
                href={draftReviewHref(item.featureId, item.draft.version)}
                external
                color="violet"
                underline="hover"
              >
                {i18n._(draftNextStep(item.draft))}
                <PiArrowSquareOut style={{ marginLeft: "var(--space-1)" }} />
              </Link>
            </Text>
          </Flex>
        ))}
      </Flex>
    </Callout>
  );
}
