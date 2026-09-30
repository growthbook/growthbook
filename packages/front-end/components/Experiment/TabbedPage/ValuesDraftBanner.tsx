import { useState } from "react";
import { Box } from "@radix-ui/themes";
import { PiPaperPlaneTilt, PiUploadSimple } from "react-icons/pi";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import useManagedFlagReview from "@/components/Experiment/LinkedChanges/useManagedFlagReview";
import { useEditsBlockedReason } from "./ExperimentEdits";

export const VALUES_DRAFT_BANNER_ID = "values-draft-banner";

/**
 * At the top of Setup while the variation values wait on their author: send
 * them for review, or, where none is required, publish them from here.
 */
export default function ValuesDraftBanner({
  experiment,
  info,
  mutate,
}: {
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  mutate: () => void;
}) {
  const review = useManagedFlagReview({ experiment, info, mutate });
  const editsBlocked = useEditsBlockedReason();
  const [error, setError] = useState<string | null>(null);
  const draft = info.pendingDraft;
  const submit = review.submit;
  // A stuck draft is fixed from its review first.
  if (!draft || !submit || draft.hasMergeConflict || draft.rebaseRequired) {
    return null;
  }
  // Publishing under review happens from the review, once approved.
  const publishes = submit.action === "publish" && !draft.pendingApproval;
  if (submit.action !== "request-review" && !publishes) return null;

  const again = draft.status === "changes-requested";
  return (
    <Box id={VALUES_DRAFT_BANNER_ID} mt="3" style={{ scrollMarginTop: 100 }}>
      <Callout
        status="info"
        icon={publishes ? <PiUploadSimple /> : <PiPaperPlaneTilt />}
        contentAlign="center"
        // The header banner's shape, which takes over once it's sent.
        style={{
          paddingTop: "var(--space-2)",
          paddingBottom: "var(--space-2)",
        }}
        action={
          <Tooltip content={editsBlocked} enabled={!!editsBlocked}>
            <Button
              color="inherit"
              onClick={submit.run}
              setError={setError}
              disabled={!submit.enabled || !!editsBlocked}
            >
              {publishes ? "Publish changes" : "Request review"}
            </Button>
          </Tooltip>
        }
      >
        <Text as="div" weight="semibold">
          {publishes
            ? "Unpublished variation values"
            : again
              ? "Addressed the requested changes?"
              : "Done editing?"}
        </Text>
        <Text as="div" size="sm" color="text-mid">
          {publishes
            ? "Publish them to change what this experiment serves."
            : again
              ? "Request another review of the variation values."
              : experiment.status === "draft"
                ? "Request a review of the variation values. They need approval before the experiment starts."
                : "Request a review of the variation values. They need approval before they go live."}
        </Text>
        {error ? (
          <HelperText status="error" size="sm">
            {error}
          </HelperText>
        ) : null}
      </Callout>
    </Box>
  );
}
