import { FC, useState } from "react";
import { Separator } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { useForm } from "react-hook-form";
import {
  getNamespaceRanges,
  isMultiRangeNamespaceFormat,
  NamespaceValue,
  validateAndFixCondition,
} from "shared/util";
import {
  areVariationWeightsValid,
  getEqualWeights,
  getLatestPhaseVariations,
} from "shared/experiments";
import { useAuth } from "@/services/auth";
import { variationWeightsTotalPercent } from "@/services/utils";
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
import Callout from "@/ui/Callout";
import {
  getLinkedExperimentAttributeScopes,
  useAttributeScopePicker,
} from "./useAttributeScopePicker";

const NewPhaseForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures?: LinkedFeatureInfo[];
  mutate: () => void;
  close: () => void;
  source?: string;
}> = ({ experiment, linkedFeatures, close, mutate, source }) => {
  const { dropdown: dropdownScope } = getLinkedExperimentAttributeScopes(
    experiment.project,
    linkedFeatures,
  );
  const [scopeAllProjects, setScopeAllProjects] = useState(
    !!experiment.attributeScopeAllProjects,
  );
  const { effectiveAttributeProjects, attributeScopeToggle } =
    useAttributeScopePicker({
      project: experiment.project,
      scopeProjects: dropdownScope,
      allProjects: scopeAllProjects,
      setAllProjects: setScopeAllProjects,
    });
  const { refreshWatching } = useWatching();

  const firstPhase = !experiment.phases.length;

  const prevPhase: Partial<ExperimentPhaseStringDates> =
    experiment.phases[experiment.phases.length - 1] || {};

  const lastPhaseVariations = getLatestPhaseVariations(experiment);
  const form = useForm<ExperimentPhaseStringDates>({
    defaultValues: {
      name: prevPhase.name || "Main",
      coverage: prevPhase.coverage ?? 1,
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
      dateStarted: new Date().toISOString(),
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
  const isValid = areVariationWeightsValid(variationWeights);

  const [conditionKey, forceConditionRender] = useIncrementer();

  const submit = form.handleSubmit(async (value) => {
    if (!isValid) throw new Error("Variation weights must add up to 100%.");

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
        <Callout status="warning">
          <strong>Warning:</strong> Starting a new phase will immediately affect
          all linked Feature Flags and Visual Changes.
        </Callout>
      )}
      <div className="row">
        <Field
          size="legacy"
          label="Name"
          containerClassName="col-lg"
          required
          {...form.register("name")}
        />
      </div>
      {!firstPhase && (
        <Field
          size="legacy"
          label="Reason for Starting New Phase"
          textarea
          {...form.register("reason")}
          placeholder="(optional)"
        />
      )}
      {!hasLinkedChanges && (
        <DatePicker
          label="Start time"
          timeZone="utc"
          date={form.watch("dateStarted")}
          setDate={(v) => {
            form.setValue("dateStarted", v ? v.toISOString() : "");
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

      {hasLinkedChanges && <Separator size="4" my="5" />}

      {hasLinkedChanges && (
        <ConditionInput
          defaultValue={form.watch("condition")}
          onChange={(condition) => form.setValue("condition", condition)}
          key={conditionKey}
          project={experiment.project || ""}
          attributeProjects={effectiveAttributeProjects}
          attributeSelectIndicator={attributeScopeToggle}
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
      {!isValid && (
        <Callout status="warning" mb="3">
          Variation weights add up to{" "}
          {variationWeightsTotalPercent(variationWeights)}%. Adjust them to add
          up to 100% to start the new phase.
        </Callout>
      )}
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
