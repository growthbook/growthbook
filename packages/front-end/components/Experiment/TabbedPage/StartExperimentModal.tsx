import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useState } from "react";
import { Box } from "@radix-ui/themes";
import Modal from "@/components/Modal";
import { useUser } from "@/services/UserContext";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import PremiumCallout from "@/ui/PremiumCallout";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  startExperiment: () => Promise<void>;
  checklistItemsRemaining: number;
  checklistHardBlockerCount?: number;
  isHoldout?: boolean;
}

export default function StartExperimentModal({
  experiment,
  close,
  startExperiment,
  checklistItemsRemaining,
  checklistHardBlockerCount = 0,
  isHoldout,
}: Props) {
  const checklistIncomplete = checklistItemsRemaining > 0;
  // Hard blockers (merge conflicts, missing approvals, unrelated draft edits)
  // can't be bypassed via "Start Anyway" — the auto-publish at start either
  // rejects them outright or would silently publish unreviewed changes.
  const hasHardBlockers = checklistHardBlockerCount > 0;

  const [upgradeModal, setUpgradeModal] = useState(false);

  const { hasCommercialFeature } = useUser();

  const needsVisualEditorUpgrade =
    experiment.hasVisualChangesets && !hasCommercialFeature("visual-editor");

  const needsRedirectUpgrade =
    experiment.hasURLRedirects && !hasCommercialFeature("redirects");

  const needsUpgrade = needsVisualEditorUpgrade || needsRedirectUpgrade;

  const [startError, setStartError] = useState<string | null>(null);

  if (needsUpgrade && upgradeModal) {
    return (
      <UpgradeModal
        close={() => setUpgradeModal(false)}
        commercialFeature={
          needsVisualEditorUpgrade ? "visual-editor" : "redirects"
        }
        source="start-experiment-modal"
      />
    );
  }

  return (
    <Modal
      trackingEventModalType="start-experiment"
      trackingEventModalSource={
        checklistIncomplete ? "incomplete-checklist" : "complete-checklist"
      }
      open={true}
      size="md"
      submit={startExperiment}
      cta="Start Now"
      ctaEnabled={!checklistIncomplete && !needsUpgrade}
      close={close}
      useRadixButton={true}
      secondaryCTA={
        checklistIncomplete && !needsUpgrade && !hasHardBlockers ? (
          <Button
            variant="ghost"
            color="red"
            onClick={startExperiment}
            setError={setStartError}
            type="button"
          >
            Start Anyway
          </Button>
        ) : null
      }
      header={isHoldout ? "Start Holdout" : "Start Experiment"}
    >
      <Box p="2">
        {checklistIncomplete && (
          <Callout status={hasHardBlockers ? "error" : "warning"} mb="3">
            You have{" "}
            <Text weight="semibold">
              {checklistItemsRemaining} task
              {checklistItemsRemaining > 1 ? "s" : ""}
            </Text>{" "}
            left to complete.{" "}
            {hasHardBlockers
              ? "Some can't be bypassed — resolve them in the Pre-Launch Checklist before this experiment can start."
              : "Review the Pre-Launch Checklist before starting this experiment."}
          </Callout>
        )}

        {needsVisualEditorUpgrade ? (
          <PremiumCallout
            commercialFeature="visual-editor"
            id="start-experiment-modal"
            mb="3"
          >
            This experiment contains visual editor changes, which require a paid
            plan.
          </PremiumCallout>
        ) : needsRedirectUpgrade ? (
          <PremiumCallout
            commercialFeature="redirects"
            id="start-experiment-modal"
            mb="3"
          >
            This experiment contains URL redirects, which require a paid plan.
          </PremiumCallout>
        ) : isHoldout ? (
          <Text as="p">
            Once started, experiments and features can be added to the holdout.
          </Text>
        ) : (
          <Text as="p">
            Once started, linked changes will be activated and users will begin
            to see your experiment variations{" "}
            <Text weight="semibold">immediately</Text>.
          </Text>
        )}

        {startError && (
          <Callout status="error" mt="3">
            {startError}
          </Callout>
        )}
      </Box>
    </Modal>
  );
}
