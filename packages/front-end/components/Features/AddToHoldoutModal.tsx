import { FeatureInterface } from "shared/types/feature";
import { useForm } from "react-hook-form";
import { Text } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useExperiments } from "@/hooks/useExperiments";
import Callout from "@/ui/Callout";
import Modal from "../Modal";
import { HoldoutSelect } from "../Holdout/HoldoutSelect";

const AddToHoldoutModal = ({
  feature,
  close,
  mutate,
}: {
  feature: FeatureInterface;
  close: () => void;
  mutate: () => void;
}) => {
  const form = useForm({
    defaultValues: {
      holdout: feature.holdout?.id ? feature.holdout : undefined,
    },
  });

  const { apiCall } = useAuth();
  const { experimentsMap } = useExperiments();

  // Only allow adding to holdout if all experiments are in draft status and don't have a holdoutId or have the same holdoutId as the feature
  const experimentsAreInDraft = feature.linkedExperiments?.every(
    (experimentId) =>
      experimentsMap[experimentId]?.status === "draft" &&
      (!experimentsMap[experimentId]?.holdoutId ||
        experimentsMap[experimentId]?.holdoutId === feature.holdout?.id),
  );

  // Check if the feature has any safe rollout rules. If it does, we can't add it to a holdout
  // go through each environment setting object and make sure no rule in its rules array has a type of experiment or safe-rollout
  const eligibleToAddToHoldout = Object.values(
    feature.environmentSettings,
  ).every((setting) =>
    setting.rules.every((rule) => rule.type !== "safe-rollout"),
  );

  const showHoldoutSelect = experimentsAreInDraft && eligibleToAddToHoldout;

  return (
    <Modal
      header="Add to holdout"
      close={close}
      open={true}
      trackingEventModalType="add-feature-to-holdout"
      size="lg"
      submit={
        showHoldoutSelect
          ? form.handleSubmit(async (value) => {
              await apiCall(`/feature/${feature.id}`, {
                method: "PUT",
                body: JSON.stringify(value),
              });

              mutate();
              close();
            })
          : undefined
      }
    >
      {(!experimentsAreInDraft || !eligibleToAddToHoldout) && (
        <Callout status="error">
          <Text>
            Holdouts cannot be added to features with safe rollout rules or
            experiments that are not in a draft state.
          </Text>
        </Callout>
      )}

      {showHoldoutSelect && (
        <HoldoutSelect
          selectedProject={feature.project}
          setHoldout={(holdoutId) => {
            form.setValue("holdout", {
              id: holdoutId,
              value: feature.defaultValue,
            });
          }}
          selectedHoldoutId={form.watch("holdout")?.id}
          formType="feature"
        />
      )}
    </Modal>
  );
};

export default AddToHoldoutModal;
