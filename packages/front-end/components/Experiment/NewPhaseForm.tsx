import { FC } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "shared/types/experiment";
import { useForm } from "react-hook-form";
import {
  getNamespaceRanges,
  isMultiRangeNamespaceFormat,
  NamespaceValue,
  validateAndFixCondition,
} from "shared/util";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import { datetime } from "shared/dates";
import { useAuth } from "@/services/auth";
import { useWatching } from "@/services/WatchProvider";
import { useIncrementer } from "@/hooks/useIncrementer";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import ConditionInput from "@/components/Features/ConditionInput";
import NamespaceSelector from "@/components/Features/NamespaceSelector";
import SavedGroupTargetingField, {
  validateSavedGroupTargeting,
} from "@/components/Features/SavedGroupTargetingField";
import DatePicker from "@/components/DatePicker";

const NewPhaseForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
  source?: string;
}> = ({ experiment, close, mutate, source }) => {
  const { refreshWatching } = useWatching();

  const firstPhase = !experiment.phases.length;

  const prevPhase: Partial<ExperimentPhaseStringDates> =
    experiment.phases[experiment.phases.length - 1] || {};

  const lastPhaseVariations = getLatestPhaseVariations(experiment);
  const form = useForm<ExperimentPhaseStringDates>({
    defaultValues: {
      name: prevPhase.name || "Main",
      coverage: prevPhase.coverage || 1,
      variationWeights:
        prevPhase.variationWeights ||
        getEqualWeights(lastPhaseVariations.length),
      variations:
        prevPhase.variations ??
        lastPhaseVariations.map((v) => ({
          id: v.id,
          status: "active" as const,
        })),
      reason: "",
      dateStarted: new Date().toISOString().substr(0, 16),
      condition: prevPhase.condition || "",
      savedGroups: prevPhase.savedGroups || [],
      seed: prevPhase.seed || "",
      namespace: (() => {
        const prevNs = prevPhase.namespace
          ? (prevPhase.namespace as NamespaceValue)
          : undefined;
        return {
          enabled: prevNs?.enabled || false,
          name: prevNs?.name || "",
          // Handle both old (single range) and new (multiple ranges) formats
          ranges: prevNs
            ? getNamespaceRanges(prevNs)
            : ([[0, 0.5]] as [number, number][]),
          // Preserve format and hashAttribute so submit is correct even if the
          // user never re-interacts with the NamespaceSelector dropdown.
          format: prevNs?.format,
          hashAttribute:
            prevNs && isMultiRangeNamespaceFormat(prevNs)
              ? prevNs.hashAttribute
              : undefined,
        };
      })(),
    },
  });

  const { apiCall } = useAuth();

  const variationWeights = form.watch("variationWeights");

  // Make sure variation weights add up to 1 (allow for a little bit of rounding error)
  const totalWeights = variationWeights.reduce(
    (total: number, weight: number) => total + weight,
    0,
  );
  const isValid = totalWeights > 0.99 && totalWeights < 1.01;

  const [conditionKey, forceConditionRender] = useIncrementer();

  const submit = form.handleSubmit(async (value) => {
    if (!isValid) throw new Error("Variation weights must sum to 1");

    validateSavedGroupTargeting(value.savedGroups);

    validateAndFixCondition(value.condition, (condition) => {
      form.setValue("condition", condition);
      forceConditionRender();
    });

    await apiCall<{ status: number; message?: string }>(
      `/experiment/${experiment.id}/phase`,
      {
        method: "POST",
        body: JSON.stringify(value),
      },
    );
    mutate();
    refreshWatching();
  });

  const hasLinkedChanges =
    !!experiment.linkedFeatures?.length || experiment.hasVisualChangesets;

  return (
    <Modal
      trackingEventModalType="new-phase-form"
      trackingEventModalSource={source}
      header={firstPhase ? "Start Experiment" : "New Experiment Phase"}
      close={close}
      open={true}
      submit={submit}
      cta={"Start"}
      closeCta="Cancel"
      size="lg"
    >
      {hasLinkedChanges && experiment.status !== "stopped" && (
        <div className="alert alert-warning">
          <strong>Warning:</strong> Starting a new phase will immediately affect
          all linked Feature Flags and Visual Changes.
        </div>
      )}
      <div className="row">
        <Field
          label="Name"
          containerClassName="col-lg"
          required
          {...form.register("name")}
        />
      </div>
      {!firstPhase && (
        <Field
          label="Reason for Starting New Phase"
          textarea
          {...form.register("reason")}
          placeholder="(optional)"
        />
      )}
      {!hasLinkedChanges && (
        <DatePicker
          label="Start Time (UTC)"
          date={form.watch("dateStarted")}
          setDate={(v) => {
            form.setValue("dateStarted", v ? datetime(v) : "");
          }}
        />
      )}

      {hasLinkedChanges && (
        <SavedGroupTargetingField
          value={form.watch("savedGroups") || []}
          setValue={(savedGroups) => form.setValue("savedGroups", savedGroups)}
          project={experiment.project || ""}
        />
      )}

      {hasLinkedChanges && (
        <ConditionInput
          defaultValue={form.watch("condition")}
          onChange={(condition) => form.setValue("condition", condition)}
          key={conditionKey}
          project={experiment.project || ""}
        />
      )}

      <FeatureVariationsInput
        valueType={"string"}
        coverage={form.watch("coverage")}
        setCoverage={(coverage) => form.setValue("coverage", coverage)}
        setWeight={(i, weight) =>
          form.setValue(`variationWeights.${i}`, weight)
        }
        variations={
          getLatestPhaseVariations(experiment).map((v, i) => {
            return {
              value: v.key || i + "",
              name: v.name,
              weight: form.watch(`variationWeights.${i}`),
              id: v.id,
            };
          }) || []
        }
        showPreview={false}
        hideCoverage={!hasLinkedChanges}
      />
      {hasLinkedChanges && (
        <NamespaceSelector
          form={form}
          featureId={experiment.trackingKey}
          trackingKey={experiment.trackingKey}
          experimentHashAttribute={experiment.hashAttribute}
          fallbackAttribute={experiment.fallbackAttribute}
        />
      )}
    </Modal>
  );
};

export default NewPhaseForm;
