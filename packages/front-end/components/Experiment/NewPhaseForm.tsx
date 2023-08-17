import { FC, useEffect, useMemo } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "@/services/auth";
import { useWatching } from "@/services/WatchProvider";
import { getEqualWeights } from "@/services/utils";
import Field from "../Forms/Field";
import FeatureVariationsInput from "../Features/FeatureVariationsInput";
import ConditionInput from "../Features/ConditionInput";
import NamespaceSelector from "../Features/NamespaceSelector";
import Toggle from "../Forms/Toggle";
import Tooltip from "../Tooltip/Tooltip";
import SelectField from "../Forms/SelectField";
import Modal from "../Modal";
import { NewBucketingSDKList } from "./HashVersionSelector";

const NewPhaseForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
}> = ({ experiment, close, mutate }) => {
  const { refreshWatching } = useWatching();

  const firstPhase = !experiment.phases.length;

  const prevPhase: Partial<ExperimentPhaseStringDates> = useMemo(
    () => experiment.phases[experiment.phases.length - 1] || {},
    [experiment.phases]
  );

  const form = useForm<
    ExperimentPhaseStringDates & { reseed: boolean; newPhase: boolean }
  >({
    defaultValues: {
      name: prevPhase.name || "Main",
      coverage: prevPhase.coverage || 1,
      variationWeights:
        prevPhase.variationWeights ||
        getEqualWeights(experiment.variations.length),
      reason: "",
      dateStarted: new Date().toISOString().substr(0, 16),
      condition: prevPhase.condition || "",
      namespace: {
        enabled: prevPhase.namespace?.enabled || false,
        name: prevPhase.namespace?.name || "",
        range: prevPhase.namespace?.range || [0, 0.5],
      },
      reseed: firstPhase ? false : true,
      newPhase: firstPhase ? true : false,
    },
  });

  const { apiCall } = useAuth();

  const variationWeights = form.watch("variationWeights");
  const coverage = form.watch("coverage");
  const condition = form.watch("condition");
  const namespace = form.watch("namespace");

  // Make sure variation weights add up to 1 (allow for a little bit of rounding error)
  const totalWeights = variationWeights.reduce(
    (total: number, weight: number) => total + weight,
    0
  );
  const isValid = totalWeights > 0.99 && totalWeights < 1.01;

  const submit = form.handleSubmit(async (value) => {
    if (!isValid) throw new Error("Variation weights must sum to 1");

    const { reseed, newPhase, ...phase } = value;

    // Creating a phase
    if (firstPhase || newPhase) {
      if (reseed && !firstPhase) {
        phase.seed = uuidv4();
      } else {
        phase.seed = prevPhase?.seed || "";
      }

      await apiCall<{ status: number; message?: string }>(
        `/experiment/${experiment.id}/phase`,
        {
          method: "POST",
          body: JSON.stringify(phase),
        }
      );
    }
    // Editing latest phase
    else {
      await apiCall(
        `/experiment/${experiment.id}/phase/${experiment.phases.length - 1}`,
        {
          method: "PUT",
          body: JSON.stringify(phase),
        }
      );
    }
    mutate();
    refreshWatching();
  });

  const hasLinkedChanges =
    !!experiment.linkedFeatures?.length || experiment.hasVisualChangesets;

  const newPhase = form.watch("newPhase") || firstPhase;

  const encodedVariationWeights = JSON.stringify(variationWeights);
  const encodedNamespace = JSON.stringify(namespace);
  const isNamespaceEnabled = namespace.enabled;
  const shouldCreateNewPhase = useMemo<boolean>(() => {
    // If there are no linked changes, the only reason to use this modal is to create a new phase
    if (!hasLinkedChanges) return true;

    // There are no phases, always need to create a new one (no reason needed)
    if (firstPhase || !prevPhase) return true;

    // Changing variation weights will almost certainly cause an SRM error
    if (
      encodedVariationWeights !== JSON.stringify(prevPhase.variationWeights)
    ) {
      return true;
    }

    // Remove outer curly braces from condition so we can use it to look for substrings
    // e.g. If they have 3 conditions ANDed together and delete one, that is a safe change
    // But if they add new conditions or modify an existing one, that is not
    // There are some edge cases with '$or' that are not handled correctly, but those are super rare
    const strippedCondition = condition.slice(1).slice(0, -1);
    if (!(prevPhase.condition || "").includes(strippedCondition)) {
      return true;
    }

    // If adding or changing a namespace
    if (
      isNamespaceEnabled &&
      encodedNamespace !== JSON.stringify(prevPhase.namespace)
    ) {
      return true;
    }

    // If reducing coverage
    if (coverage < (prevPhase.coverage ?? 1)) {
      return true;
    }

    // If not changing any of the above, no reason to create a new phase
    return false;
  }, [
    firstPhase,
    coverage,
    prevPhase,
    encodedVariationWeights,
    condition,
    isNamespaceEnabled,
    encodedNamespace,
    hasLinkedChanges,
  ]);

  useEffect(() => {
    form.setValue("newPhase", shouldCreateNewPhase);
  }, [form, shouldCreateNewPhase]);

  return (
    <Modal
      header={"Modify Experiment"}
      open={true}
      close={close}
      submit={submit}
      cta={"Save"}
      closeCta="Cancel"
      size="lg"
    >
      {hasLinkedChanges && (
        <div className="alert alert-info">
          Any changes you make here will affect all linked Feature Flags and
          Visual Changes when you save.
        </div>
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
        <>
          <hr />
          <h3>Experiment Phase Settings</h3>
          {!hasLinkedChanges ? (
            <div className="alert alert-info">
              Creating a new phase will exclude data from previous phases during
              analysis. Basically, it lets you throw away old data and start
              fresh.
            </div>
          ) : (
            <div className="alert alert-info">
              We have defaulted you to the recommended phase settings below
              based on the changes you made above. Changing these settings may
              introduce bias to your results or cause a poor user experience.
            </div>
          )}
          {hasLinkedChanges && (
            <SelectField
              label="Experiment Phase"
              options={[
                {
                  label: "Start a New Phase",
                  value: "new",
                },
                {
                  label: "Update Existing Phase",
                  value: "existing",
                },
              ]}
              formatOptionLabel={(value) => {
                const recommended =
                  (value.value === "new" && shouldCreateNewPhase) ||
                  (value.value === "existing" && !shouldCreateNewPhase);

                return (
                  <>
                    {value.label}{" "}
                    {recommended && (
                      <span className="badge badge-purple badge-pill ml-2">
                        recommended
                      </span>
                    )}
                  </>
                );
              }}
              value={newPhase ? "new" : "existing"}
              onChange={(value) =>
                form.setValue("newPhase", value === "new" ? true : false)
              }
            />
          )}

          {newPhase && (
            <>
              {!hasLinkedChanges ? (
                <>
                  <div className="row">
                    <Field
                      label="Name"
                      containerClassName="col-lg"
                      required
                      {...form.register("name")}
                    />
                  </div>
                  <Field
                    label="Reason for Starting New Phase"
                    textarea
                    {...form.register("reason")}
                    placeholder="(optional)"
                  />
                  <Field
                    label="Start Time (UTC)"
                    type="datetime-local"
                    {...form.register("dateStarted")}
                  />
                </>
              ) : (
                <div className="form-group">
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
                    Removes carryover bias. Returning visitors will be
                    re-bucketed and may start seeing a different variation from
                    before. Only supported in{" "}
                    <Tooltip
                      body={
                        <>
                          Only supported in the following SDKs:
                          <NewBucketingSDKList />
                          Unsupported SDKs and versions will simply ignore this
                          setting and continue with the previous randomization.
                        </>
                      }
                    >
                      <span className="text-primary">some SDKs</span>
                    </Tooltip>
                  </small>
                </div>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
};

export default NewPhaseForm;
