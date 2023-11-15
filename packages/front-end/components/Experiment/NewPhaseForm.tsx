import React, { FC } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import { useWatching } from "@/services/WatchProvider";
import { getEqualWeights } from "@/services/utils";
import Toggle from "@/components/Forms/Toggle";
import Tooltip from "@/components/Tooltip/Tooltip";
import { NewBucketingSDKList } from "@/components/Experiment/HashVersionSelector";
import Modal from "../Modal";
import Field from "../Forms/Field";
import FeatureVariationsInput from "../Features/FeatureVariationsInput";
import ConditionInput from "../Features/ConditionInput";
import NamespaceSelector from "../Features/NamespaceSelector";
import SavedGroupTargetingField, {
  validateSavedGroupTargeting,
} from "../Features/SavedGroupTargetingField";

const NewPhaseForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
}> = ({ experiment, close, mutate }) => {
  const { refreshWatching } = useWatching();

  const firstPhase = !experiment.phases.length;

  const prevPhase: Partial<ExperimentPhaseStringDates> =
    experiment.phases[experiment.phases.length - 1] || {};

  const form = useForm<ExperimentPhaseStringDates & { reseed: boolean }>({
    defaultValues: {
      name: prevPhase.name || "Main",
      coverage: prevPhase.coverage || 1,
      variationWeights:
        prevPhase.variationWeights ||
        getEqualWeights(experiment.variations.length),
      reason: "",
      dateStarted: new Date().toISOString().substr(0, 16),
      condition: prevPhase.condition || "",
      savedGroups: prevPhase.savedGroups || [],
      seed: prevPhase.seed || "",
      namespace: {
        enabled: prevPhase.namespace?.enabled || false,
        name: prevPhase.namespace?.name || "",
        range: prevPhase.namespace?.range || [0, 0.5],
      },
      reseed: true,
    },
  });

  const { apiCall } = useAuth();

  const variationWeights = form.watch("variationWeights");

  // Make sure variation weights add up to 1 (allow for a little bit of rounding error)
  const totalWeights = variationWeights.reduce(
    (total: number, weight: number) => total + weight,
    0
  );
  const isValid = totalWeights > 0.99 && totalWeights < 1.01;

  const submit = form.handleSubmit(async (value) => {
    if (!isValid) throw new Error("Variation weights must sum to 1");

    validateSavedGroupTargeting(value.savedGroups);

    await apiCall<{ status: number; message?: string }>(
      `/experiment/${experiment.id}/phase`,
      {
        method: "POST",
        body: JSON.stringify(value),
      }
    );
    mutate();
    refreshWatching();
  });

  const hasLinkedChanges =
    !!experiment.linkedFeatures?.length || experiment.hasVisualChangesets;

  return (
    <Modal
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
        <Field
          label="Start Time (UTC)"
          type="datetime-local"
          {...form.register("dateStarted")}
        />
      )}

      {hasLinkedChanges && (
        <SavedGroupTargetingField
          value={form.watch("savedGroups") || []}
          setValue={(savedGroups) => form.setValue("savedGroups", savedGroups)}
        />
      )}

      {hasLinkedChanges && (
        <ConditionInput
          defaultValue={form.watch("condition")}
          onChange={(condition) => form.setValue("condition", condition)}
        />
      )}

      <FeatureVariationsInput
        valueType={"string"}
        coverage={form.watch("coverage")}
        setCoverage={(coverage) => form.setValue("coverage", coverage)}
        setWeight={(i, weight) =>
          form.setValue(`variationWeights.${i}`, weight)
        }
        valueAsId={true}
        variations={
          experiment.variations.map((v, i) => {
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
        />
      )}

      {!firstPhase && (
        <div className="form-group mt-4">
          <Toggle
            id="reseed-traffic"
            value={form.watch("reseed")}
            setValue={(reseed) => form.setValue("reseed", reseed)}
          />{" "}
          <label htmlFor="reseed-traffic" className="text-dark">
            Re-randomize Traffic
          </label>{" "}
          <span className="badge badge-purple badge-pill ml-2">
            recommended
          </span>
          <small className="form-text text-muted">
            Removes carryover bias. Returning visitors will be re-bucketed and
            may start seeing a different variation from before. Only supported
            in{" "}
            <Tooltip
              body={
                <>
                  Only supported in the following SDKs:
                  <NewBucketingSDKList />
                  Unsupported SDKs and versions will simply ignore this setting
                  and continue with the previous randomization.
                </>
              }
            >
              <span className="text-primary">some SDKs</span>
            </Tooltip>
          </small>
        </div>
      )}
    </Modal>
  );
};

export default NewPhaseForm;
