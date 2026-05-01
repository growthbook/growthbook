import { UseFormReturn } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { useAttributeSchema, useEnvironments } from "@/services/features";
import FallbackAttributeSelector from "@/components/Features/FallbackAttributeSelector";
import {
  AttributeOptionWithTooltip,
  type AttributeOptionForTooltip,
} from "@/components/Features/AttributeOptionTooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import FeatureVariationsInput from "@/components//Features/FeatureVariationsInput";
import NamespaceSelector from "@/components//Features/NamespaceSelector";
import SelectField from "@/components//Forms/SelectField";
import TargetingFieldsGroup from "@/components/Features/TargetingFieldsGroup";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import HashVersionSelector from "./HashVersionSelector";
import type { ChangeType } from "./MakeChangesFlow";

export interface TargetingFormProps {
  experiment: ExperimentInterfaceStringDates;
  form: UseFormReturn<ExperimentTargetingData>;
  safeToEdit: boolean;
  changeType?: ChangeType;
  conditionKey: number;
  setPrerequisiteTargetingSdkIssues: (v: boolean) => void;
}

export default function TargetingForm({
  experiment,
  form,
  safeToEdit,
  changeType = "advanced",
  conditionKey,
  setPrerequisiteTargetingSdkIssues,
}: TargetingFormProps) {
  const hasLinkedChanges =
    !!experiment.linkedFeatures?.length || !!experiment.hasVisualChangesets;

  const attributeSchema = useAttributeSchema(false, experiment.project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const hashAttributeOptions: AttributeOptionForTooltip[] = attributeSchema
    .filter((s) => !hasHashAttributes || s.hashAttribute)
    .map((s) => ({
      label: s.property,
      value: s.property,
      description: s.description,
      tags: s.tags,
      datatype: s.datatype,
      hashAttribute: s.hashAttribute,
    }));

  // If the current hashAttribute isn't in the list, add it for backwards compatibility
  // this could happen if the hashAttribute has been archived, or removed from the experiment's project after the experiment was creaetd
  if (
    form.watch("hashAttribute") &&
    !hashAttributeOptions.find((o) => o.value === form.watch("hashAttribute"))
  ) {
    hashAttributeOptions.push({
      label: form.watch("hashAttribute"),
      value: form.watch("hashAttribute"),
    });
  }

  const settings = useOrgSettings();
  const { getDatasourceById } = useDefinitions();
  const datasource = experiment.datasource
    ? getDatasourceById(experiment.datasource)
    : null;
  const supportsSQL = datasource?.properties?.queryLanguage === "sql";

  const environments = useEnvironments();
  const envs = environments.map((e) => e.id);

  const type = experiment.type;

  const orgStickyBucketing = !!settings.useStickyBucketing;

  return (
    <div className="pt-2">
      {safeToEdit && (
        <>
          <Field
            label="Tracking Key"
            labelClassName="font-weight-bold"
            {...form.register("trackingKey")}
            helpText={
              supportsSQL ? (
                <>
                  Unique identifier for this experiment, used to track
                  impressions and analyze results. Will match against the{" "}
                  <code>experiment_id</code> column in your data source.
                </>
              ) : (
                <>
                  Unique identifier for this experiment, used to track
                  impressions and analyze results. Must match the experiment id
                  in your tracking callback.
                </>
              )
            }
          />
          <SelectField
            withRadixThemedPortal
            containerClassName="flex-1"
            label="Assign variation based on attribute"
            labelClassName="font-weight-bold"
            options={hashAttributeOptions}
            sort={false}
            value={form.watch("hashAttribute")}
            onChange={(v) => {
              form.setValue("hashAttribute", v);
            }}
            formatOptionLabel={(o, meta) => {
              return (
                <AttributeOptionWithTooltip
                  option={o as AttributeOptionForTooltip}
                  context={meta.context}
                >
                  {o.label}
                </AttributeOptionWithTooltip>
              );
            }}
            helpText={"The globally unique tracking key for the experiment"}
          />
          <FallbackAttributeSelector
            form={form}
            attributeSchema={attributeSchema}
          />
          <HashVersionSelector
            value={form.watch("hashVersion")}
            onChange={(v) => form.setValue("hashVersion", v)}
            project={experiment.project}
          />

          {orgStickyBucketing ? (
            <Checkbox
              mt="4"
              size="lg"
              label="Disable Sticky Bucketing"
              description="Do not persist variation assignments for this experiment (overrides your organization settings)"
              value={!!form.watch("disableStickyBucketing")}
              setValue={(v) => {
                form.setValue("disableStickyBucketing", v === true);
              }}
            />
          ) : null}
        </>
      )}

      {(!hasLinkedChanges || safeToEdit) && <hr className="my-4" />}
      {!hasLinkedChanges && (
        <Callout status="info" mb="4">
          Changes made below are only metadata changes and will have no impact
          on actual experiment delivery unless you link a GrowthBook-managed
          Linked Feature or Visual Change to this experiment.
        </Callout>
      )}

      {["targeting", "advanced"].includes(changeType) && (
        <>
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
          {["advanced"].includes(changeType) && <hr />}
        </>
      )}

      {["namespace", "advanced"].includes(changeType) && (
        <>
          <NamespaceSelector
            form={form}
            featureId={experiment.trackingKey}
            trackingKey={experiment.trackingKey}
            experimentHashAttribute={form.watch("hashAttribute")}
            fallbackAttribute={form.watch("fallbackAttribute")}
          />
          {["advanced"].includes(changeType) && <hr />}
        </>
      )}

      {["traffic", "weights", "advanced"].includes(changeType) && (
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
          disableCoverage={changeType === "weights"}
          disableVariations={changeType === "traffic"}
          hideVariations={type === "multi-armed-bandit"}
          label={
            changeType === "traffic" || type === "multi-armed-bandit"
              ? "Traffic Percentage"
              : changeType === "weights"
                ? "Variation Weights"
                : "Traffic Percentage & Variation Weights"
          }
          startEditingSplits={true}
        />
      )}
    </div>
  );
}
