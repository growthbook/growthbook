import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import Callout from "@/ui/Callout";
import { HoldoutSelect } from "@/components/Holdout/HoldoutSelect";
import DialogLayout from "@/ui/Dialog/Patterns/DialogLayout";
import Text from "@/ui/Text";

const AddToHoldoutModal = ({
  experiment,
  close,
  mutate,
}: {
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  mutate: () => void;
}) => {
  const form = useForm({
    defaultValues: { holdoutId: experiment.holdoutId || undefined },
  });

  const { apiCall } = useAuth();

  const experimentHasLinkedFeatures =
    (experiment.linkedFeatures?.length ?? 0) > 0;

  const experimentIsNotCompatibleWithHoldouts =
    experiment.hasVisualChangesets || experiment.hasURLRedirects;

  const showHoldoutSelect =
    !experimentIsNotCompatibleWithHoldouts && !experimentHasLinkedFeatures;

  return (
    <DialogLayout
      header="Add to holdout"
      close={close}
      open={true}
      trackingEventModalType="add-feature-to-holdout"
      size="lg"
      submit={
        showHoldoutSelect
          ? form.handleSubmit(async (value) => {
              await apiCall(`/experiment/${experiment.id}`, {
                method: "POST",
                body: JSON.stringify(value),
              });

              mutate();
              close();
            })
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
          setHoldout={(holdoutId) => {
            form.setValue("holdoutId", holdoutId);
          }}
          selectedHoldoutId={form.watch("holdoutId")}
          formType="experiment"
        />
      )}
    </DialogLayout>
  );
};

export default AddToHoldoutModal;
