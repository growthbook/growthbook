import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { ApiContextualBanditInterface } from "shared/validators";
import { validateAndFixCondition } from "shared/util";
import { FeaturePrerequisite, SavedGroupTargeting } from "shared/types/feature";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import TargetingFieldsGroup from "@/components/Features/TargetingFieldsGroup";
import ContextualBanditAssignmentAttributeSelect from "@/components/ContextualBandit/ContextualBanditAssignmentAttributeSelect";

type FormValues = {
  coverage: number;
  hashAttribute: string;
  condition: string;
  savedGroups: SavedGroupTargeting[];
  prerequisites: FeaturePrerequisite[];
  variationWeights: number[];
};

/**
 * Combined Traffic & Targeting editor. Reuses the shared `FeatureVariationsInput`
 * (coverage-only via `hideVariations`, mirroring the experiment bandit
 * `EditTrafficModal` — weights stay algorithm-managed), the shared
 * assignment-attribute select, and `ConditionInput` for attribute targeting.
 */
export default function ContextualBanditTrafficTargetingModal({
  cb,
  mutate,
  close,
}: {
  cb: ApiContextualBanditInterface;
  mutate: () => void;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const environments = useEnvironments();

  const [conditionKey, setConditionKey] = useState(0);
  const [prerequisiteTargetingSdkIssues, setPrerequisiteTargetingSdkIssues] =
    useState(false);

  const numVariations = cb.variations.length;
  const form = useForm<FormValues>({
    defaultValues: {
      coverage: cb.coverage ?? 1,
      hashAttribute: cb.hashAttribute || "id",
      condition: cb.condition ?? "",
      savedGroups: cb.savedGroups ?? [],
      prerequisites: cb.prerequisites ?? [],
      variationWeights: cb.variations.map(
        (v) =>
          cb.variationWeights?.find((w) => w.variationId === v.id)?.weight ??
          1 / (numVariations || 2),
      ),
    },
  });

  return (
    <FormProvider {...form}>
      <ModalStandard
        open
        trackingEventModalType="cb-edit-traffic-targeting"
        header="Edit Traffic & Targeting"
        close={close}
        cta="Save"
        ctaEnabled={!prerequisiteTargetingSdkIssues}
        size="lg"
        submit={form.handleSubmit(async (data) => {
          let condition = data.condition;
          validateAndFixCondition(condition, (fixed) => {
            condition = fixed;
            form.setValue("condition", fixed);
            setConditionKey((k) => k + 1);
          });

          const coverage = Math.min(1, Math.max(0, data.coverage));

          await apiCall(`/api/v1/contextual-bandits/${cb.id}`, {
            method: "PUT",
            body: JSON.stringify({
              coverage,
              hashAttribute: data.hashAttribute || undefined,
              condition,
              savedGroups: data.savedGroups,
              prerequisites: data.prerequisites,
            }),
          });
          mutate();
        })}
      >
        <FeatureVariationsInput
          valueType="string"
          label="Traffic included in this Bandit"
          coverageLabel="Traffic included in this Bandit"
          coverageTooltip="Users not included in the Bandit will skip this experiment"
          coverage={form.watch("coverage")}
          setCoverage={(coverage) => form.setValue("coverage", coverage)}
          setWeight={(i, weight) =>
            form.setValue(`variationWeights.${i}`, weight)
          }
          variations={cb.variations.map((v, i) => ({
            value: v.key || `${i}`,
            name: v.name,
            weight: form.watch(`variationWeights.${i}`),
            id: v.id,
          }))}
          showPreview={false}
          hideVariations
        />

        <hr className="my-4" />

        <ContextualBanditAssignmentAttributeSelect project={cb.project} />

        <hr className="my-4" />

        <TargetingFieldsGroup
          project={cb.project ?? ""}
          environments={environments.map((e) => e.id)}
          savedGroups={form.watch("savedGroups") || []}
          setSavedGroups={(v) => form.setValue("savedGroups", v)}
          condition={form.watch("condition") || ""}
          setCondition={(v) => form.setValue("condition", v)}
          conditionKey={conditionKey}
          prerequisites={form.watch("prerequisites") || []}
          setPrerequisites={(v) => form.setValue("prerequisites", v)}
          setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
        />
      </ModalStandard>
    </FormProvider>
  );
}
