import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import NamespaceSelector from "@/components/Features/NamespaceSelector";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import MakeChangesFlow from "./MakeChangesFlow";
import { useExperimentTargetingForm } from "./useExperimentTargetingForm";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  safeToEdit: boolean;
}

export default function EditNamespaceModal({
  close,
  experiment,
  mutate,
  safeToEdit,
}: Props) {
  const {
    form,
    defaultValues,
    conditionKey,
    setPrerequisiteTargetingSdkIssues,
    canSubmit,
    onSubmit,
  } = useExperimentTargetingForm(experiment);

  if (safeToEdit) {
    return (
      <ModalStandard
        trackingEventModalType=""
        open={true}
        close={close}
        header="Edit Namespace"
        subheader="Run mutually exclusive experiments within a shared namespace."
        ctaEnabled={canSubmit}
        submit={onSubmit(mutate, "namespace")}
        size="lg"
      >
        <div className="pt-2">
          <NamespaceSelector
            form={form}
            featureId={experiment.trackingKey}
            trackingKey={experiment.trackingKey}
            experimentHashAttribute={form.watch("hashAttribute")}
            fallbackAttribute={form.watch("fallbackAttribute")}
            hideEnableToggle
          />
        </div>
      </ModalStandard>
    );
  }

  return (
    <MakeChangesFlow
      experiment={experiment}
      form={form}
      defaultValues={defaultValues}
      onSubmit={(scope) => onSubmit(mutate, scope)()}
      close={close}
      canSubmit={canSubmit}
      conditionKey={conditionKey}
      setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
    />
  );
}
