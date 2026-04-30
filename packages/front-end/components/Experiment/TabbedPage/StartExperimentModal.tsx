import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { format } from "date-fns";
import { useState } from "react";
import Modal from "@/components/Modal";
import { useUser } from "@/services/UserContext";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import PremiumCallout from "@/ui/PremiumCallout";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  startExperiment: () => Promise<void>;
  checklistItemsRemaining: number;
  isHoldout?: boolean;
  scheduledDate?: string;
}

export default function StartExperimentModal({
  experiment,
  close,
  startExperiment,
  checklistItemsRemaining,
  isHoldout,
  scheduledDate,
}: Props) {
  const checklistIncomplete = checklistItemsRemaining > 0;
  const parsedScheduledDate = scheduledDate ? new Date(scheduledDate) : null;
  const isScheduleStart = !!parsedScheduledDate;

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
      cta={
        isScheduleStart && parsedScheduledDate
          ? `Start ${
              isHoldout ? "Holdout" : "Experiment"
            } on ${format(parsedScheduledDate, "MMM d")}`
          : "Start Now"
      }
      ctaEnabled={!checklistIncomplete && !needsUpgrade}
      close={close}
      useRadixButton={true}
      secondaryCTA={
        checklistIncomplete && !needsUpgrade ? (
          <Button
            variant="ghost"
            color="red"
            onClick={startExperiment}
            setError={setStartError}
            type="button"
          >
            {isScheduleStart && parsedScheduledDate
              ? `Schedule Anyway`
              : "Start Anyway"}
          </Button>
        ) : null
      }
      header={
        isScheduleStart
          ? `Schedule ${isHoldout ? "Holdout" : "Experiment"}`
          : isHoldout
            ? "Start Holdout"
            : "Start Experiment"
      }
    >
      <div className="p-2">
        {checklistIncomplete ? (
          <div className="alert alert-warning">
            You have{" "}
            <strong>
              {checklistItemsRemaining} task
              {checklistItemsRemaining > 1 ? "s " : " "}
            </strong>
            left to complete. Review the Pre-Launch Checklist before starting
            this experiment.
          </div>
        ) : null}

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
        ) : isScheduleStart && parsedScheduledDate ? (
          <div>
            This will move the {isHoldout ? "holdout" : "experiment"} to{" "}
            <strong>Scheduled</strong> and set it to start on{" "}
            <strong>
              {format(parsedScheduledDate, "MMM d, yyyy 'at' h:mm a")}
            </strong>
            .
          </div>
        ) : isHoldout ? (
          <div>
            Once started, experiments and features can be added to the holdout.
          </div>
        ) : (
          <div>
            Once started, linked changes will be activated and users will begin
            to see your experiment variations <strong>immediately</strong>.
          </div>
        )}

        {startError && (
          <Callout status="error" mt="3">
            {startError}
          </Callout>
        )}
      </div>
    </Modal>
  );
}
