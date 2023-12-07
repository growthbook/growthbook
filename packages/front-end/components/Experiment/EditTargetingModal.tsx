import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
} from "back-end/types/experiment";
import React, { useEffect, useMemo } from "react";
import { FaInfoCircle } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import { getEqualWeights } from "@/services/utils";
import { useAttributeSchema } from "@/services/features";
import ReleaseChangesForm from "@/components/Experiment/ReleaseChangesForm";
import useOrgSettings from "@/hooks/useOrgSettings";
import Field from "../Forms/Field";
import Modal from "../Modal";
import FeatureVariationsInput from "../Features/FeatureVariationsInput";
import ConditionInput from "../Features/ConditionInput";
import NamespaceSelector from "../Features/NamespaceSelector";
import SelectField from "../Forms/SelectField";
import SavedGroupTargetingField, {
  validateSavedGroupTargeting,
} from "../Features/SavedGroupTargetingField";
import HashVersionSelector from "./HashVersionSelector";

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
  const settings = useOrgSettings();
  const orgStickyBucketing = settings.useStickyBucketing;

  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const form = useForm<ExperimentTargetingData>({
    defaultValues: {
      condition: lastPhase?.condition ?? "",
      savedGroups: lastPhase?.savedGroups ?? [],
      coverage: lastPhase?.coverage ?? 1,
      hashAttribute: experiment.hashAttribute || "id",
      fallbackAttribute: experiment.fallbackAttribute || "",
      hashVersion: experiment.hashVersion || 2,
      disableStickyBucketing: experiment.disableStickyBucketing ?? false,
      bucketVersion: experiment.bucketVersion || 1,
      minBucketVersion: experiment.minBucketVersion || 0,
      blockedVariations: experiment.blockedVariations || [],
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
      bodyClassName="p-0"
    >
      <div className="px-4 pt-4">
        {safeToEdit ? (
          <>
            <Field
              label="Tracking Key"
              labelClassName="font-weight-bold"
              {...form.register("trackingKey")}
              helpText="Unique identifier for this experiment, used to track impressions and analyze results"
            />
            <div className="d-flex" style={{ gap: "2rem" }}>
              <SelectField
                containerClassName="flex-1"
                label="Assign variation based on attribute"
                labelClassName="font-weight-bold"
                options={attributeSchema
                  .filter((s) => !hasHashAttributes || s.hashAttribute)
                  .map((s) => ({ label: s.property, value: s.property }))}
                sort={false}
                value={form.watch("hashAttribute")}
                onChange={(v) => {
                  form.setValue("hashAttribute", v);
                }}
                helpText={
                  "Will be hashed together with the Tracking Key to determine which variation to assign"
                }
              />
              <SelectField
                containerClassName="flex-1"
                label="Fallback attribute"
                labelClassName="font-weight-bold"
                options={[
                  { label: "none", value: "" },
                  ...attributeSchema
                    .filter((s) => !hasHashAttributes || s.hashAttribute)
                    .map((s) => ({ label: s.property, value: s.property })),
                ]}
                formatOptionLabel={({ value, label }) => {
                  if (!value) {
                    return <em className="text-muted">{label}</em>;
                  }
                  return label;
                }}
                sort={false}
                value={
                  orgStickyBucketing
                    ? form.watch("fallbackAttribute") || ""
                    : ""
                }
                onChange={(v) => {
                  form.setValue("fallbackAttribute", v);
                }}
                helpText={
                  <>
                    <div>
                      If the user&apos;s assignment attribute is not available
                      the fallback attribute may be used instead.
                    </div>
                    {!orgStickyBucketing && (
                      <div className="text-warning-orange mt-1">
                        <FaInfoCircle /> Sticky bucketing is currently disabled
                        for your organization.
                      </div>
                    )}
                  </>
                }
                disabled={!orgStickyBucketing}
              />
            </div>
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
          setBlockedVariations={(bv) => form.setValue("blockedVariations", bv)}
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
          blockedVariations={form.watch("blockedVariations") || []}
          showPreview={false}
        />
        <NamespaceSelector
          form={form}
          featureId={experiment.trackingKey}
          trackingKey={experiment.trackingKey}
        />
      </div>

      {!safeToEdit && lastPhase && (
        <ReleaseChangesForm experiment={experiment} form={form} />
      )}
    </Modal>
  );
}
