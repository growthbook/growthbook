import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "shared/types/experiment";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import { useAuth } from "@/services/auth";
import { distributeWeights } from "@/services/utils";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import track from "@/services/track";
import MakeChangesFlow from "./MakeChangesFlow";
import { useExperimentTargetingForm } from "./useExperimentTargetingForm";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  safeToEdit: boolean;
  // Auto-focus this variation's Name field when the modal opens.
  focusVariationId?: string | null;
  // Append a new variation on open and focus its Name field.
  addVariationOnOpen?: boolean;
}

export default function EditTrafficModal({
  close,
  experiment,
  mutate,
  safeToEdit,
  focusVariationId,
  addVariationOnOpen,
}: Props) {
  if (safeToEdit) {
    return (
      <EditTrafficForm
        close={close}
        experiment={experiment}
        mutate={mutate}
        focusVariationId={focusVariationId}
        addVariationOnOpen={addVariationOnOpen}
      />
    );
  }

  return <MakeChanges close={close} experiment={experiment} mutate={mutate} />;
}

function EditTrafficForm({
  close,
  experiment,
  mutate,
  focusVariationId,
  addVariationOnOpen,
}: {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  focusVariationId?: string | null;
  addVariationOnOpen?: boolean;
}) {
  const { apiCall } = useAuth();
  const isBandit = experiment.type === "multi-armed-bandit";

  const latestPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const form = useForm<
    ExperimentInterfaceStringDates & {
      variationWeights: number[];
      coverage: number;
    }
  >({
    defaultValues: {
      variations: getLatestPhaseVariations(experiment).map((v) => ({
        id: v.id,
        key: v.key,
        name: v.name,
        description: v.description,
        screenshots: v.screenshots,
      })),
      variationWeights:
        latestPhase?.variationWeights ??
        getEqualWeights(experiment.variations.length, 4),
      coverage: latestPhase?.coverage ?? 1,
    },
  });

  const submit = form.handleSubmit(async (value) => {
    const originalVariationCount = getLatestPhaseVariations(experiment).length;
    const data = { ...value };
    data.variations = [...value.variations].map((variation, i) => {
      if (!variation.key) variation.key = i + "";
      return variation;
    });

    // fix some common bugs
    if (!isBandit) {
      const newWeights = [
        ...data.variations.map((_, i) =>
          Math.min(
            Math.max(
              data.variationWeights?.[i] ?? 1 / (data.variations?.length || 2),
              0,
            ),
            1,
          ),
        ),
      ];
      data.variationWeights = distributeWeights(newWeights, true);
    } else {
      const latestVariationWeights = latestPhase?.variationWeights ?? [];
      if (
        data.variations.length !== data.variationWeights.length ||
        data.variations.length !== latestVariationWeights.length
      ) {
        // only recompute weights if original weights are the wrong size
        data.variationWeights = getEqualWeights(data.variations.length || 2, 4);
      } else {
        data.variationWeights = [...latestVariationWeights];
      }
    }

    await apiCall(`/experiment/${experiment.id}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    mutate();
    track("edited-traffic");

    const numVariationsAdded = data.variations.length - originalVariationCount;
    if (numVariationsAdded > 0) {
      track("Added Variations", {
        source: "edit-traffic-modal",
        numVariationsAdded,
        totalVariations: data.variations.length,
      });
    }
  });

  return (
    <ModalStandard
      trackingEventModalType="edit-traffic-modal"
      open={true}
      close={close}
      header="Edit Traffic & Variations"
      submit={submit}
      size="lg"
    >
      <div className="pt-2">
        <FeatureVariationsInput
          label={null}
          valueAsId={isBandit}
          hideSplits={isBandit}
          coverage={form.watch("coverage")}
          setCoverage={(coverage) => form.setValue("coverage", coverage)}
          setWeight={(i, weight) =>
            form.setValue(`variationWeights.${i}`, weight)
          }
          variations={
            form.watch("variations")?.map((v, i) => ({
              value: v.key || "",
              name: v.name,
              description: v.description,
              screenshots: v.screenshots,
              weight: form.watch(`variationWeights.${i}`),
              id: v.id,
            })) ?? []
          }
          setVariations={(v) => {
            form.setValue(
              "variations",
              v.map((data) => {
                const { value, ...newData } = data;
                return {
                  name: "",
                  description: "",
                  screenshots: [],
                  ...newData,
                  key: value,
                };
              }),
            );
            form.setValue(
              `variationWeights`,
              v.map((v) => v.weight),
            );
          }}
          showPreview
          showDescriptions
          autoFocusVariationId={focusVariationId}
          autoAddVariationOnMount={addVariationOnOpen}
        />
      </div>
    </ModalStandard>
  );
}

function MakeChanges({
  close,
  experiment,
  mutate,
}: {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}) {
  const {
    form,
    defaultValues,
    conditionKey,
    setPrerequisiteTargetingSdkIssues,
    canSubmit,
    onSubmit,
  } = useExperimentTargetingForm(experiment);

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
