import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import isEqual from "lodash/isEqual";
import NamespaceSelector from "@/components/Features/NamespaceSelector";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import MakeChangesFlow from "./MakeChangesFlow";
import { getLinkedExperimentAttributeScopes } from "./useAttributeScopePicker";
import {
  ExperimentTargetingDraft,
  useExperimentTargetingForm,
} from "./useExperimentTargetingForm";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures?: LinkedFeatureInfo[];
  mutate: () => void;
  safeToEdit: boolean;
  // Apply to the caller's draft instead of saving (set in review, for the
  // Setup page), as Edit Targeting does: the modal starts from the draft
  // (value; null when it has none), and its button, "Apply", hands the
  // namespace back; the page's save bar then saves it. Only when safeToEdit.
  draft?: {
    value: ExperimentTargetingDraft | null;
    onApply: (namespace: ExperimentTargetingDraft["namespace"]) => void;
  };
}

export default function EditNamespaceModal({
  close,
  experiment,
  linkedFeatures,
  mutate,
  safeToEdit,
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
  } = useExperimentTargetingForm(
    experiment,
    enforcement,
    safeToEdit ? draft?.value : null,
  );

  if (safeToEdit) {
    return (
      <ModalStandard
        trackingEventModalType=""
        open={true}
        close={close}
        header="Edit Namespace"
        subheader="Run mutually exclusive experiments within a shared namespace."
        cta={draft ? "Apply" : undefined}
        // Apply only once the namespace differs from where it started.
        ctaEnabled={
          canSubmit &&
          (!draft || !isEqual(form.watch("namespace"), defaultValues.namespace))
        }
        submit={
          draft
            ? onSubmit(mutate, "namespace", (value) =>
                draft.onApply(value.namespace),
              )
            : onSubmit(mutate, "namespace")
        }
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
