import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
  LinkedFeaturePendingDraft,
} from "shared/types/experiment";
import { startBypassCovers } from "shared/util";
import { ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import StatusDot from "@/components/Experiment/StatusDot";
import useManagedFlagReview from "@/components/Experiment/LinkedChanges/useManagedFlagReview";
import { usePreLaunchChecklist } from "@/components/PreLaunchChecklist/PreLaunchChecklistProvider";
import {
  draftStatusDotColor,
  revisionStatusLabel,
} from "@/components/Reviews/RevisionStatusBadge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
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
import { useEditsBlockedReason } from "./ExperimentEdits";

type DraftInReview = {
  featureId: string;
  draft: LinkedFeaturePendingDraft;
  publishesAtStart: boolean;
  // The experiment's own flag, reviewed on the experiment rather than the flag.
  managed: LinkedFeatureInfo | null;
};

const READY_STATES: DraftReviewState[] = ["approved", "ready"];

function listHeading(states: DraftReviewState[]): string {
  const ready = states.filter((state) => READY_STATES.includes(state)).length;
  if (ready === states.length) {
    return "The following Feature Flags are ready to publish:";
  }
  if (states.every((state) => state === "changes-requested")) {
    return "Changes were requested on the following Feature Flags:";
  }
  return ready
    ? "The following Feature Flags need approval or publishing:"
    : "The following Feature Flags need approval:";
}

function DraftLink({
  featureId,
  draft,
}: Pick<DraftInReview, "featureId" | "draft">) {
  return (
    <Link
      href={revisionHref(featureId, draft.version)}
      external
      color="violet"
      underline="hover"
    >
      <strong>{featureId}</strong>
      <Tooltip content={revisionStatusLabel(draft.status)}>
        <StatusDot
          inline
          color={draftStatusDotColor(draft.status)}
          style={{ marginLeft: "var(--space-2)" }}
        />
      </Tooltip>{" "}
      Revision {draft.version}
    </Link>
  );
}

function reviewSentence({
  featureId,
  draft,
  managed,
}: DraftInReview): ReactNode {
  if (managed) {
    const values = <strong>variation values</strong>;
    switch (draftReviewState(draft)) {
      case "changes-requested":
        return <>Changes were requested on the {values}.</>;
      case "approved":
        return <>The {values} are approved.</>;
      case "ready":
        return <>The {values} are ready to publish.</>;
      case "needs-approval":
        return <>The {values} need approval.</>;
      case "in-review":
        return <>The {values} are in review.</>;
    }
  }
  const subject = (
    <>
      Feature Flag <DraftLink featureId={featureId} draft={draft} />
    </>
  );
  switch (draftReviewState(draft)) {
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
  const state = draftReviewState(draft);
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

// The experiment's own flag is reviewed on the experiment: open that review
// once there is one, otherwise take the next step in place.
function ManagedReviewAction({
  experiment,
  info,
  mutate,
  openReview,
  asLink = false,
}: {
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  mutate: () => void;
  openReview: (() => void) | null;
  asLink?: boolean;
}) {
  const review = useManagedFlagReview({ experiment, info, mutate });
  const editsBlocked = useEditsBlockedReason();
  const [error, setError] = useState<string | null>(null);
  const action = openReview
    ? { label: "View review", run: openReview }
    : review.submit?.enabled
      ? { label: review.submit.label, run: review.submit.run }
      : null;
  if (!action) return null;
  const shownError = error ?? review.error;
  if (asLink) {
    return editsBlocked ? (
      <Tooltip content={editsBlocked}>
        <span>
          <Text color="text-low">{action.label}</Text>
        </span>
      </Tooltip>
    ) : (
      <Flex direction="column" align="end" gap="1">
        <Link
          onClick={async () => {
            setError(null);
            try {
              await action.run();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
          color="violet"
          underline="hover"
        >
          {action.label}
        </Link>
        {shownError ? (
          <HelperText status="error" size="sm">
            {shownError}
          </HelperText>
        ) : null}
      </Flex>
    );
  }
  return (
    <Flex direction="column" align="end" gap="1">
      <Tooltip content={editsBlocked} enabled={!!editsBlocked}>
        <Button
          variant="outline"
          size="sm"
          onClick={action.run}
          setError={setError}
          disabled={!!editsBlocked}
        >
          {action.label}
        </Button>
      </Tooltip>
      {shownError ? (
        <HelperText status="error" size="sm">
          {shownError}
        </HelperText>
      ) : null}
    </Flex>
  );
}

// A draft that publishes when the experiment starts needs nothing until then,
// unless it's waiting on a review the start won't bypass.
export default function DraftReviewCallouts({
  experiment,
  linkedFeatures,
  managedFeatureId = null,
  openReview = null,
  mutate,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  managedFeatureId?: string | null;
  // null where there's no review to open yet, or it can't open.
  openReview?: (() => void) | null;
  mutate: () => void;
}) {
  // Before launch, the checklist tracks the draft the start publishes, and no
  // other bears on the experiment.
  const { active: checklistActive } = usePreLaunchChecklist();
  if (checklistActive) return null;
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
        ? [
            {
              featureId: info.feature.id,
              draft,
              publishesAtStart,
              managed: info.feature.id === managedFeatureId ? info : null,
            },
          ]
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
          only.managed ? (
            <ManagedReviewAction
              experiment={experiment}
              info={only.managed}
              mutate={mutate}
              openReview={openReview}
            />
          ) : (
            <LinkButton
              href={draftReviewHref(only.featureId, only.draft.version)}
              external
              variant="outline"
              size="sm"
              icon={<PiArrowSquareOut />}
              iconPosition="right"
            >
              {draftNextStep(only.draft)}
            </LinkButton>
          )
        }
      >
        {reviewSentence(only)}
        {start ? ` ${start}` : null}
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
                {item.managed ? (
                  <strong>Variation values</strong>
                ) : (
                  <DraftLink featureId={item.featureId} draft={item.draft} />
                )}
              </Text>
              {item.publishesAtStart ? (
                <Text color="text-low">Publishes at start</Text>
              ) : null}
            </Flex>
            <Text whiteSpace="nowrap">
              {item.managed ? (
                <ManagedReviewAction
                  experiment={experiment}
                  info={item.managed}
                  mutate={mutate}
                  openReview={openReview}
                  asLink
                />
              ) : (
                <Link
                  href={draftReviewHref(item.featureId, item.draft.version)}
                  external
                  color="violet"
                  underline="hover"
                >
                  {draftNextStep(item.draft)}
                  <PiArrowSquareOut style={{ marginLeft: "var(--space-1)" }} />
                </Link>
              )}
            </Text>
          </Flex>
        ))}
      </Flex>
    </Callout>
  );
}
