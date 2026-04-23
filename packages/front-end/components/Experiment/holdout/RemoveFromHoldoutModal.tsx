import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

type Props = {
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  mutate: () => void;
};

export default function RemoveFromHoldoutModal({
  experiment,
  close,
  mutate,
}: Props) {
  const { apiCall } = useAuth();

  const experimentIsDraft = experiment.status === "draft";
  const experimentHasLinkedChanges =
    experiment.hasURLRedirects ||
    experiment.hasVisualChangesets ||
    (experiment.linkedFeatures?.length ?? 0) > 0;
  const canRemoveFromHoldout = experimentIsDraft && !experimentHasLinkedChanges;

  const handleSubmit = async () => {
    await apiCall(`/experiment/${experiment.id}`, {
      method: "POST",
      body: JSON.stringify({ holdoutId: "" }),
    });
    mutate();
    close();
  };

  return (
    <Modal
      header="Remove from holdout"
      close={close}
      open={true}
      trackingEventModalType="remove-experiment-from-holdout"
      size="lg"
      cta="Remove"
      submit={handleSubmit}
      ctaEnabled={canRemoveFromHoldout}
    >
      {!canRemoveFromHoldout ? (
        <Callout status="error">
          <Text>
            Only draft experiments with no linked features can be removed from a
            holdout.
          </Text>
        </Callout>
      ) : (
        <Callout status="warning">
          <Text>
            Removing this experiment from its holdout will stop holdout-based
            exclusion for when the experiment is running.
          </Text>
        </Callout>
      )}
    </Modal>
  );
}
