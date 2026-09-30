import { Box } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ago } from "shared/dates";
import { getLatestPhaseVariations } from "shared/experiments";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import EventUser from "@/components/Avatar/EventUser";
import { useUser } from "@/services/UserContext";
import useManagedFlagReview from "@/components/Experiment/LinkedChanges/useManagedFlagReview";
import {
  environmentStatesDiffer,
  getVariationValueChanges,
} from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";
import { useEditsBlockedReason } from "./ExperimentEdits";
import { getValuesBanner, ReviewEvent } from "./valuesBanner";

/** The Values flag's unpublished draft, above the tabs: its review state and the way in. */
export default function ValuesReviewBanner({
  experiment,
  info,
  mutate,
  reviewing,
  openReview,
}: {
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  mutate: () => void;
  reviewing: boolean;
  // null where the review can't open, e.g. an archived experiment.
  openReview: (() => void) | null;
}) {
  const review = useManagedFlagReview({ experiment, info, mutate });
  const { userId } = useUser();
  const editsBlocked = useEditsBlockedReason();
  const draft = info.pendingDraft;
  if (!draft) return null;

  // Newest first; a retracted verdict no longer stands.
  const log = [...review.reviewComments].reverse();
  const event = (
    entry: (typeof log)[number] | undefined,
  ): ReviewEvent | null =>
    entry ? { user: entry.user, ago: ago(entry.timestamp) } : null;
  const requestEntry = log.find((l) => l.action === "Review Requested");
  const verdictEntry = log.find(
    (l) =>
      (l.action === "Approved" || l.action === "Requested Changes") &&
      !l.retraction,
  );
  const changeCount =
    getVariationValueChanges(
      info,
      getLatestPhaseVariations(experiment).map((v) => v.id),
    ).filter((c) => c.unpublished).length +
    (environmentStatesDiffer(info) ? 1 : 0) +
    (draft.valueType !== info.feature.valueType ? 1 : 0);

  const banner = getValuesBanner({
    experimentStatus: experiment.status,
    draft,
    changeCount,
    canReview: review.canReview,
    viewerRequested:
      requestEntry?.user?.type === "dashboard" &&
      requestEntry.user.id === userId,
    requested: event(requestEntry),
    verdict: event(verdictEntry),
  });

  if (!banner) return null;
  const detail = banner.detail;
  return (
    <Callout
      status={banner.status}
      contentAlign="center"
      style={{
        paddingTop: "var(--space-2)",
        paddingBottom: "var(--space-2)",
      }}
      action={
        openReview ? (
          // Kept, unseen, on the review itself, so the banner holds its shape.
          <Box
            style={reviewing ? { visibility: "hidden" } : undefined}
            aria-hidden={reviewing || undefined}
          >
            <Tooltip content={editsBlocked} enabled={!!editsBlocked}>
              <Button
                color="inherit"
                variant={banner.status === "success" ? "ghost" : "solid"}
                onClick={openReview}
                disabled={reviewing || !!editsBlocked}
              >
                {banner.cta}
              </Button>
            </Tooltip>
          </Box>
        ) : undefined
      }
    >
      <Text as="div" weight="semibold">
        {banner.title}
      </Text>
      {/* Always a second line, so the banner's height doesn't depend on it. */}
      <Text as="div" size="sm" color="text-mid">
        {detail === null ? (
          " "
        ) : typeof detail === "string" ? (
          detail
        ) : (
          <>
            <EventUser user={detail.user} display="name" /> · {detail.ago}
          </>
        )}
      </Text>
    </Callout>
  );
}
