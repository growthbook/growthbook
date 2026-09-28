import { useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Callout from "@/ui/Callout";
import { HoldoutSelect } from "@/components/Holdout/HoldoutSelect";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";

/** Picks the experiment's holdout, staged for the page's Save. */
const AddToHoldoutModal = ({
  experiment,
  holdoutId,
  stage,
  close,
}: {
  experiment: ExperimentInterfaceStringDates;
  /** The holdout shown now, staged or stored; empty for none. */
  holdoutId: string;
  stage: (holdoutId: string) => void;
  close: () => void;
}) => {
  const [selected, setSelected] = useState(holdoutId);

  const experimentHasLinkedFeatures =
    (experiment.linkedFeatures?.length ?? 0) > 0;

  const experimentIsNotCompatibleWithHoldouts =
    experiment.hasVisualChangesets || experiment.hasURLRedirects;

  const showHoldoutSelect =
    !experimentIsNotCompatibleWithHoldouts && !experimentHasLinkedFeatures;

  return (
    <ModalStandard
      header={holdoutId ? "Change holdout" : "Add to holdout"}
      close={close}
      open={true}
      trackingEventModalType="add-feature-to-holdout"
      size="lg"
      cta="Apply"
      // "None" clears a holdout that's set; there's nothing to clear otherwise.
      ctaEnabled={showHoldoutSelect && selected !== holdoutId}
      submit={
        showHoldoutSelect
          ? async () => {
              stage(selected);
            }
          : undefined
      }
    >
      {experimentHasLinkedFeatures && (
        <Callout status="error">
          <Text>
            Holdouts cannot be added to experiments with linked features that
            are not already in the holdout. Please add the holdout to the
            feature first.
          </Text>
        </Callout>
      )}

      {experimentIsNotCompatibleWithHoldouts && (
        <Callout status="error">
          <Text>
            Holdouts cannot be added to experiments with Visual Changesets or
            URL redirects.
          </Text>
        </Callout>
      )}

      {showHoldoutSelect && (
        <HoldoutSelect
          selectedProject={experiment.project}
          setHoldout={(id) => setSelected(id ?? "")}
          selectedHoldoutId={selected}
          keepSelection
          formType="experiment"
        />
      )}
    </ModalStandard>
  );
};

export default AddToHoldoutModal;
