import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
} from "back-end/types/experiment";
import { FaInfoCircle } from "react-icons/fa";
import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
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

  const defaultValues = {
    condition: lastPhase?.condition ?? "",
    savedGroups: lastPhase?.savedGroups ?? [],
    coverage: lastPhase?.coverage ?? 1,
    hashAttribute: experiment.hashAttribute || "id",
    fallbackAttribute: experiment.fallbackAttribute || "",
    hashVersion: experiment.hashVersion || 2,
    disableStickyBucketing: experiment.disableStickyBucketing ?? false,
    bucketVersion: experiment.bucketVersion || 1,
    minBucketVersion: experiment.minBucketVersion || 0,
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
  };

  const form = useForm<ExperimentTargetingData>({
    defaultValues,
  });
  const { apiCall } = useAuth();

  const attributeSchema = useAttributeSchema();
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const _formValues = omit(form.getValues(), [
    "newPhase",
    "reseed",
    "bucketVersion",
    "minBucketVersion",
  ]);
  const _defaultValues = omit(defaultValues, [
    "newPhase",
    "reseed",
    "bucketVersion",
    "minBucketVersion",
  ]);
  const hasChanges = !isEqual(_formValues, _defaultValues);

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
      cta={
        hasChanges ? (safeToEdit ? "Save" : "Save and Publish") : "No changes"
      }
      ctaEnabled={hasChanges}
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
          value={form.watch("savedGroups") || []}
          setValue={(v) => form.setValue("savedGroups", v)}
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
      </div>

      {!safeToEdit && lastPhase && hasChanges && (
        <ReleaseChangesForm experiment={experiment} form={form} />
      )}
    </Modal>
  );
}
