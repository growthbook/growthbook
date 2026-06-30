import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useEnvironments } from "@/services/features";
import TargetingFieldsGroup from "@/components/Features/TargetingFieldsGroup";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import MakeChangesFlow from "./MakeChangesFlow";
import { useExperimentTargetingForm } from "./useExperimentTargetingForm";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  safeToEdit: boolean;
}

export default function EditTargetingModal({
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

  const environments = useEnvironments();
  const envs = environments.map((e) => e.id);

  if (safeToEdit) {
    return (
      <ModalStandard
        trackingEventModalType=""
        open={true}
        close={close}
        header="Edit Targeting"
        ctaEnabled={canSubmit}
        submit={onSubmit(mutate, "targeting")}
        size="lg"
      >
        <div className="pt-2">
          <TargetingFieldsGroup
            project={experiment.project || ""}
            environments={envs}
            savedGroups={form.watch("savedGroups") || []}
            setSavedGroups={(v) => form.setValue("savedGroups", v)}
            condition={form.watch("condition")}
            setCondition={(condition) => form.setValue("condition", condition)}
            conditionKey={conditionKey}
            prerequisites={form.watch("prerequisites") || []}
            setPrerequisites={(prerequisites) =>
              form.setValue("prerequisites", prerequisites)
            }
            setPrerequisiteTargetingSdkIssues={
              setPrerequisiteTargetingSdkIssues
            }
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
