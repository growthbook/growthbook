import { UseFormReturn } from "react-hook-form";
import { Box } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { useEnvironments } from "@/services/features";
import FeatureVariationsInput from "@/components//Features/FeatureVariationsInput";
import NamespaceSelector from "@/components//Features/NamespaceSelector";
import TargetingFieldsGroup from "@/components/Features/TargetingFieldsGroup";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import { useAttributeScopePicker } from "./useAttributeScopePicker";
import type { ChangeType } from "./MakeChangesFlow";

export interface TargetingFormProps {
  experiment: ExperimentInterfaceStringDates;
  attributeProjects?: string[] | null;
  form: UseFormReturn<ExperimentTargetingData>;
  changeType?: ChangeType;
  conditionKey: number;
  setPrerequisiteTargetingSdkIssues: (v: boolean) => void;
}

export default function TargetingForm({
  experiment,
  attributeProjects,
  form,
  changeType = "advanced",
  conditionKey,
  setPrerequisiteTargetingSdkIssues,
}: TargetingFormProps) {
  const restrictedAttributeProjects =
    attributeProjects !== undefined
      ? attributeProjects
      : experiment.project
        ? [experiment.project]
        : null;
  const { effectiveAttributeProjects, attributeScopeToggle } =
    useAttributeScopePicker({
      project: experiment.project,
      scopeProjects: restrictedAttributeProjects,
      allProjects: form.watch("attributeScopeAllProjects"),
      setAllProjects: (v) => form.setValue("attributeScopeAllProjects", v),
    });
  const hasLinkedChanges =
    !!experiment.linkedFeatures?.length || !!experiment.hasVisualChangesets;

  const environments = useEnvironments();
  const envs = environments.map((e) => e.id);

  const type = experiment.type;
  const isAdvancedChange = changeType === "advanced";
  // A Bandit sets its own weights, so it has nothing here to hold back.
  const holdsBack =
    type !== "multi-armed-bandit" &&
    (changeType === "traffic" || changeType === "weights");

  return (
    <div className="pt-2">
      {!hasLinkedChanges && (
        <>
          <hr className="my-4" />
          <Callout status="info" mb="4">
            Changes made below are only metadata changes and will have no impact
            on actual experiment delivery unless you link a GrowthBook-managed
            Linked Feature or Visual Change to this experiment.
          </Callout>
        </>
      )}

      {["targeting", "advanced"].includes(changeType) && (
        <>
          <TargetingFieldsGroup
            project={experiment.project || ""}
            attributeProjects={effectiveAttributeProjects}
            attributeSelectIndicator={attributeScopeToggle}
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
          {isAdvancedChange && <hr />}
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
          {isAdvancedChange && <hr />}
        </>
      )}

      {holdsBack ? (
        <Box mb="2">
          <Text as="div" weight="semibold">
            {changeType === "traffic" ? "Traffic percent" : "Variation weights"}
          </Text>
          <Text as="div" size="sm" color="text-mid">
            {changeType === "traffic"
              ? "Only the traffic percent changes here. To change variation weights too, go back and choose Advanced."
              : "Only variation weights change here. To change the traffic percent too, go back and choose Advanced."}
          </Text>
        </Box>
      ) : null}
      {["traffic", "weights", "advanced"].includes(changeType) && (
        <FeatureVariationsInput
          valueType={"string"}
          valueAsId
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
          showPreview
          disableCoverage={changeType === "weights"}
          disableVariations={changeType === "traffic"}
          hideSplits={type === "multi-armed-bandit"}
          coverageLabel={
            type === "multi-armed-bandit"
              ? "Traffic included in this Bandit"
              : undefined
          }
          // Alone on its step, it is named above or by its slider.
          label={
            !isAdvancedChange
              ? null
              : type === "multi-armed-bandit"
                ? "Traffic percent"
                : "Traffic percent and variation weights"
          }
          startEditingSplits={true}
        />
      )}
    </div>
  );
}
