import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
} from "back-end/types/experiment";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/services/auth";
import { getEqualWeights } from "@/services/utils";
import { useAttributeSchema } from "@/services/features";
import Field from "../Forms/Field";
import Modal from "../Modal";
import FeatureVariationsInput from "../Features/FeatureVariationsInput";
import ConditionInput from "../Features/ConditionInput";
import NamespaceSelector from "../Features/NamespaceSelector";
import SelectField from "../Forms/SelectField";
import Toggle from "../Forms/Toggle";
import Tooltip from "../Tooltip/Tooltip";
import { DocLink } from "../DocLink";
import SavedGroupTargetingField, {
  validateSavedGroupTargeting,
} from "../Features/SavedGroupTargetingField";
import HashVersionSelector, {
  NewBucketingSDKList,
} from "./HashVersionSelector";

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
  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const form = useForm<ExperimentTargetingData>({
    defaultValues: {
      condition: lastPhase?.condition ?? "",
      savedGroups: lastPhase?.savedGroups ?? [],
      coverage: lastPhase?.coverage ?? 1,
      hashAttribute: experiment.hashAttribute || "id",
      hashVersion: experiment.hashVersion || 2,
      namespace: lastPhase?.namespace || {
        enabled: false,
        name: "",
        range: [0, 1],
      },
      seed: lastPhase?.seed ?? "",
      trackingKey: experiment.trackingKey || "",
      variationWeights:
        lastPhase?.variationWeights ??
        getEqualWeights(experiment.variations.length, 4),
      newPhase: false,
      reseed: true,
    },
  });
  const { apiCall } = useAuth();

  const attributeSchema = useAttributeSchema();
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const newPhase = form.watch("newPhase");
  const variationWeights = form.watch("variationWeights");
  const coverage = form.watch("coverage");
  const condition = form.watch("condition");
  const namespace = form.watch("namespace");
  const savedGroups = form.watch("savedGroups");
  const encodedVariationWeights = JSON.stringify(variationWeights);
  const encodedNamespace = JSON.stringify(namespace);
  const isNamespaceEnabled = namespace.enabled;
  const shouldCreateNewPhase = useMemo<boolean>(() => {
    // If it's safe to edit (or there is no previous phase), we don't need to ask about creating a new phase
    if (safeToEdit) return false;
    if (!lastPhase) return false;

    // Changing variation weights will almost certainly cause an SRM error
    if (
      encodedVariationWeights !== JSON.stringify(lastPhase.variationWeights)
    ) {
      return true;
    }

    // Remove outer curly braces from condition so we can use it to look for substrings
    // e.g. If they have 3 conditions ANDed together and delete one, that is a safe change
    // But if they add new conditions or modify an existing one, that is not
    // There are some edge cases with '$or' that are not handled correctly, but those are super rare
    const strippedCondition = condition.slice(1).slice(0, -1);
    if (!(lastPhase.condition || "").includes(strippedCondition)) {
      return true;
    }

    // Changing saved groups
    // TODO: certain changes should be safe, so make this logic smarter
    if (
      JSON.stringify(savedGroups || []) !==
      JSON.stringify(lastPhase.savedGroups || [])
    ) {
      return true;
    }

    // If adding or changing a namespace
    if (
      isNamespaceEnabled &&
      encodedNamespace !== JSON.stringify(lastPhase.namespace)
    ) {
      return true;
    }

    // If reducing coverage
    if (coverage < (lastPhase.coverage ?? 1)) {
      return true;
    }

    // If not changing any of the above, no reason to create a new phase
    return false;
  }, [
    coverage,
    lastPhase,
    encodedVariationWeights,
    condition,
    isNamespaceEnabled,
    encodedNamespace,
    savedGroups,
    safeToEdit,
  ]);

  useEffect(() => {
    form.setValue("newPhase", shouldCreateNewPhase);
    form.setValue("reseed", true);
  }, [form, shouldCreateNewPhase]);

  return (
    <Modal
      open={true}
      close={close}
      header={`Edit Targeting`}
      submit={form.handleSubmit(async (value) => {
        validateSavedGroupTargeting(value.savedGroups);

        await apiCall(`/experiment/${experiment.id}/targeting`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
      })}
      cta={safeToEdit ? "Save" : "Save and Publish"}
      size="lg"
    >
      {safeToEdit ? (
        <>
          <Field
            label="Tracking Key"
            labelClassName="font-weight-bold"
            {...form.register("trackingKey")}
            helpText="Unique identifier for this experiment, used to track impressions and analyze results"
          />
          <SelectField
            label="Assignment Attribute"
            labelClassName="font-weight-bold"
            options={attributeSchema
              .filter((s) => !hasHashAttributes || s.hashAttribute)
              .map((s) => ({ label: s.property, value: s.property }))}
            value={form.watch("hashAttribute")}
            onChange={(v) => {
              form.setValue("hashAttribute", v);
            }}
            helpText={
              "Will be hashed together with the Tracking Key to determine which variation to assign"
            }
          />
          <HashVersionSelector
            value={form.watch("hashVersion")}
            onChange={(v) => form.setValue("hashVersion", v)}
          />
        </>
      ) : (
        <div className="alert alert-warning">
          <div>
            <strong>
              Warning: Experiment is still{" "}
              {experiment.status === "running" ? "running" : "live"}
            </strong>
          </div>
          Changes you make here will apply to all linked Feature Flags and
          Visual Editor changes immediately upon saving.
        </div>
      )}
      <SavedGroupTargetingField
        value={savedGroups || []}
        setValue={(savedGroups) => form.setValue("savedGroups", savedGroups)}
      />
      <ConditionInput
        defaultValue={form.watch("condition")}
        onChange={(condition) => form.setValue("condition", condition)}
      />
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
      />
      <NamespaceSelector
        form={form}
        featureId={experiment.trackingKey}
        trackingKey={experiment.trackingKey}
      />

      {!safeToEdit && lastPhase && (
        <>
          <hr />
          <div className="alert alert-info">
            We have defaulted you to the recommended release settings below
            based on the changes you made above. These recommendations will
            prevent bias and data quality issues in your results.{" "}
            <DocLink docSection="targetingChanges">Learn more</DocLink>
          </div>
          <SelectField
            label="How to release changes"
            options={[
              {
                label: "Start a new phase",
                value: "new",
              },
              {
                label: "Update the existing phase",
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

          {newPhase && (
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
                Removes carryover bias. Returning visitors will be re-bucketed
                and may start seeing a different variation from before. Only
                supported in{" "}
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
    </Modal>
  );
}
