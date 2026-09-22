import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import NamespaceSelector from "@/components/Features/NamespaceSelector";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import MakeChangesFlow from "./MakeChangesFlow";
import { getLinkedExperimentAttributeScopes } from "./useAttributeScopePicker";
import { useExperimentTargetingForm } from "./useExperimentTargetingForm";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures?: LinkedFeatureInfo[];
  mutate: () => void;
  safeToEdit: boolean;
  /** Stages the confirmed change instead of writing it, as targeting does. */
  stageChanges?: (value: ExperimentTargetingData) => void;
  /** Targeting already staged, which the form opens on. */
  draft?: ExperimentTargetingData | null;
}

export default function EditNamespaceModal({
  close,
  experiment,
  linkedFeatures,
  mutate,
  safeToEdit,
  stageChanges,
  draft,
}: Props) {
  const { enforcement, dropdown } = getLinkedExperimentAttributeScopes(
    experiment.project,
    linkedFeatures,
  );
  const {
    form,
    defaultValues,
    conditionKey,
    setPrerequisiteTargetingSdkIssues,
    canSubmit,
    onSubmit,
  } = useExperimentTargetingForm(experiment, enforcement, draft);

  if (safeToEdit) {
    return (
      <ModalStandard
        trackingEventModalType=""
        open={true}
        close={close}
        header="Edit Namespace"
        subheader="Run mutually exclusive experiments within a shared namespace."
        ctaEnabled={canSubmit}
        cta={stageChanges ? "Confirm" : "Save"}
        submit={onSubmit(mutate, "namespace", stageChanges)}
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
      attributeProjects={dropdown}
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
