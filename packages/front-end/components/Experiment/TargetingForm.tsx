import { UseFormReturn } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { useEnvironments } from "@/services/features";
import FeatureVariationsInput from "@/components//Features/FeatureVariationsInput";
import NamespaceSelector from "@/components//Features/NamespaceSelector";
import TargetingFieldsGroup from "@/components/Features/TargetingFieldsGroup";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import VariationSplitTable from "@/components/Experiment/VariationSplitTable";
import RemoveVariationsSection, {
  RemoveVariationDraftVariation,
  RemoveVariationMode,
} from "@/components/Experiment/RemoveVariationsSection";
import type { ChangeType } from "./MakeChangesFlow";

export interface TargetingFormProps {
  experiment: ExperimentInterfaceStringDates;
  form: UseFormReturn<ExperimentTargetingData>;
  changeType?: ChangeType;
  conditionKey: number;
  removeVariationMode: RemoveVariationMode;
  setRemoveVariationMode: (v: RemoveVariationMode) => void;
  removeVariationDraft: RemoveVariationDraftVariation[];
  setRemoveVariationDraft: React.Dispatch<
    React.SetStateAction<RemoveVariationDraftVariation[]>
  >;
  setPrerequisiteTargetingSdkIssues: (v: boolean) => void;
}

export default function TargetingForm({
  experiment,
  form,
  changeType = "advanced",
  conditionKey,
  removeVariationMode,
  setRemoveVariationMode,
  removeVariationDraft,
  setRemoveVariationDraft,
  setPrerequisiteTargetingSdkIssues,
}: TargetingFormProps) {
  const hasLinkedChanges =
    !!experiment.linkedFeatures?.length || !!experiment.hasVisualChangesets;

  const environments = useEnvironments();
  const envs = environments.map((e) => e.id);

  const type = experiment.type;
  const isAdvancedChange = changeType === "advanced";

  const phaseVariations = useMemo(
    () => getLatestPhaseVariations(experiment),
    [experiment],
  );

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

      {["traffic", "weights", "advanced"].includes(changeType) &&
        (isAdvancedChange ? (
          <>
            <FeatureVariationsInput
              valueType={"string"}
              coverage={form.watch("coverage")}
              setCoverage={(coverage) => form.setValue("coverage", coverage)}
              valueAsId={true}
              variations={phaseVariations.map((v, i) => ({
                value: v.key || i + "",
                name: v.name,
                weight: form.watch(`variationWeights.${i}`),
                id: v.id,
              }))}
              showPreview={false}
              hideVariations={true}
              label="Traffic Percentage"
            />
            {type !== "multi-armed-bandit" && (
              <VariationSplitTable
                label="Variation Weights"
                rows={phaseVariations}
                getRowKey={(v) => v.id}
                getWeightIndex={(row) =>
                  phaseVariations.findIndex((v) => v.id === row.id)
                }
                weights={phaseVariations.map((_, i) =>
                  form.watch(`variationWeights.${i}`),
                )}
                onApplyWeights={(next) => {
                  next.forEach((w, i) => {
                    form.setValue(`variationWeights.${i}`, w, {
                      shouldDirty: true,
                    });
                  });
                }}
                startEditingSplits={true}
                splitsAreEqual={(() => {
                  const wts = phaseVariations.map((_, i) =>
                    form.watch(`variationWeights.${i}`),
                  );
                  return (
                    wts.length <= 1 ||
                    wts.every((w) => Math.abs(w - wts[0]) < 0.0001)
                  );
                })()}
                onSetEqualWeights={() => {
                  const equal = getEqualWeights(phaseVariations.length, 4);
                  equal.forEach((w, i) => {
                    form.setValue(`variationWeights.${i}`, w, {
                      shouldDirty: true,
                    });
                  });
                }}
                renderVariationCell={(v) => (
                  <Flex
                    align="center"
                    className={`variation variation${v.index} with-variation-label`}
                    style={{ maxWidth: 200, flex: 1, minWidth: 0 }}
                  >
                    <span
                      className="label"
                      style={{
                        width: 20,
                        height: 20,
                        flex: "none",
                        marginTop: "-1px",
                      }}
                    >
                      {v.index}
                    </span>
                    <Text whiteSpace="normal">{v.name}</Text>
                  </Flex>
                )}
              />
            )}
          </>
        ) : (
          <FeatureVariationsInput
            valueType={"string"}
            coverage={form.watch("coverage")}
            setCoverage={(coverage) => form.setValue("coverage", coverage)}
            setWeight={(i, weight) =>
              form.setValue(`variationWeights.${i}`, weight)
            }
            valueAsId={true}
            variations={phaseVariations.map((v, i) => ({
              value: v.key || i + "",
              name: v.name,
              weight: form.watch(`variationWeights.${i}`),
              id: v.id,
            }))}
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
        ))}

      {changeType === "remove-variation" && (
        <RemoveVariationsSection
          variations={removeVariationDraft}
          setVariations={setRemoveVariationDraft}
          mode={removeVariationMode}
          setMode={setRemoveVariationMode}
          usedViaRemoveVariation={true}
        />
      )}
    </div>
  );
}
