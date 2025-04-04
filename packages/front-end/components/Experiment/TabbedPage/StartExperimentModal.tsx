import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useState } from "react";
import Modal from "@/components/Modal";
import { useUser } from "@/services/UserContext";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import PremiumCallout from "@/components/Radix/PremiumCallout";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  startExperiment: () => Promise<void>;
  checklistItemsRemaining: number;
}

export default function StartExperimentModal({
  experiment,
  close,
  startExperiment,
  checklistItemsRemaining,
}: Props) {
  const checklistIncomplete = checklistItemsRemaining > 0;

  const [upgradeModal, setUpgradeModal] = useState(false);

  const { hasCommercialFeature } = useUser();

  const needsVisualEditorUpgrade =
    experiment.hasVisualChangesets && !hasCommercialFeature("visual-editor");

  const needsRedirectUpgrade =
    experiment.hasURLRedirects && !hasCommercialFeature("redirects");

  const needsUpgrade = needsVisualEditorUpgrade || needsRedirectUpgrade;

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
      secondaryCTA={
        checklistIncomplete && !needsUpgrade ? (
          <button
            className="btn btn-link text-decoration-none"
            onClick={async () => startExperiment()}
          >
            <span
              style={{
                color: "var(--text-color-danger)",
              }}
            >
              Start Anyway
            </span>
          </button>
        ) : null
      }
      header="Start Experiment"
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
        ) : (
          <div>
            Once started, linked changes will be activated and users will begin
            to see your experiment variations <strong>immediately</strong>.
          </div>
        )}
      </div>
    </Modal>
  );
}
