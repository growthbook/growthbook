import { UseFormReturn } from "react-hook-form";
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
import type { ChangeType } from "./MakeChangesFlow";

export interface TargetingFormProps {
  experiment: ExperimentInterfaceStringDates;
  form: UseFormReturn<ExperimentTargetingData>;
  changeType?: ChangeType;
  conditionKey: number;
  setPrerequisiteTargetingSdkIssues: (v: boolean) => void;
}

export default function TargetingForm({
  experiment,
  form,
  changeType = "advanced",
  conditionKey,
  setPrerequisiteTargetingSdkIssues,
}: TargetingFormProps) {
  const hasLinkedChanges =
    !!experiment.linkedFeatures?.length || !!experiment.hasVisualChangesets;

  const environments = useEnvironments();
  const envs = environments.map((e) => e.id);

  const type = experiment.type;
  const isAdvancedChange = changeType === "advanced";

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
