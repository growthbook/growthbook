import { contextualBanditEndpoints } from "shared/api-endpoints";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import {
  ApiContextualBanditInterface,
  DEFAULT_MEASUREMENT_ARM_PERCENT,
  MAX_MEASUREMENT_ARM_PERCENT,
} from "shared/validators";
import { validateAndFixCondition } from "shared/util";
import { FeaturePrerequisite, SavedGroupTargeting } from "shared/types/feature";
import { useRestApiCall } from "@/services/restApi";
import { useEnvironments } from "@/services/features";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import { decimalToPercent, percentToDecimal } from "@/services/utils";
import variationInputStyles from "@/components/Features/VariationsInput.module.scss";
import Field from "@/components/Forms/Field";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import TargetingFieldsGroup from "@/components/Features/TargetingFieldsGroup";
import ContextualBanditAssignmentAttributeSelect from "@/components/ContextualBandit/ContextualBanditAssignmentAttributeSelect";

type FormValues = {
  coverage: number;
  hashAttribute: string;
  condition: string;
  savedGroups: SavedGroupTargeting[];
  prerequisites: FeaturePrerequisite[];
  measurementArmEnabled: boolean;
  measurementArmPercent: number;
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
  const restApiCall = useRestApiCall();
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
      measurementArmEnabled: cb.measurementArm?.enabled ?? false,
      measurementArmPercent:
        cb.measurementArm?.percent ?? DEFAULT_MEASUREMENT_ARM_PERCENT,
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

          await restApiCall(contextualBanditEndpoints.updateContextualBandit, {
            params: { id: cb.id },
            body: {
              coverage,
              hashAttribute: data.hashAttribute || undefined,
              condition,
              savedGroups: data.savedGroups,
              prerequisites: data.prerequisites,
              ...(cb.status === "draft"
                ? {
                    measurementArmEnabled: data.measurementArmEnabled,
                    measurementArmPercent: data.measurementArmPercent,
                  }
                : {}),
            },
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

        {cb.status === "draft" ? (
          <>
            <div>
              <Text as="label" weight="medium" mb="1">
                Measurement Arm Size
              </Text>
              <Text as="div" color="text-mid" mb="2">
                Enter the percent of eligible traffic to hold back from the
                bandit on the default experience. The rest of the traffic goes
                to the bandit, and the two are compared on the Results tab. Set
                to 0 for no measurement arm. Locked once the bandit starts.
              </Text>
              <div
                className={`position-relative ${variationInputStyles.percentInputWrap} ${variationInputStyles.hideArrows}`}
                style={{ width: 110 }}
              >
                <Field
                  size="md"
                  style={{ width: 95 }}
                  value={
                    form.watch("measurementArmEnabled")
                      ? decimalToPercent(form.watch("measurementArmPercent"))
                      : 0
                  }
                  onChange={(e) => {
                    let pct = percentToDecimal(e.target.value);
                    if (isNaN(pct) || pct < 0) pct = 0;
                    if (pct > MAX_MEASUREMENT_ARM_PERCENT)
                      pct = MAX_MEASUREMENT_ARM_PERCENT;
                    form.setValue("measurementArmEnabled", pct > 0);
                    form.setValue("measurementArmPercent", pct);
                  }}
                  type="number"
                  min={0}
                  max={decimalToPercent(MAX_MEASUREMENT_ARM_PERCENT)}
                  step="1"
                />
                <span>%</span>
              </div>
            </div>
          </>
        ) : (
          <div className="form-group">
            <label>Measurement arm</label>
            <div className="text-muted">
              {cb.measurementArm?.enabled
                ? `${Math.round(cb.measurementArm.percent * 100)}% of eligible users are held back on the default experience. This is locked once the bandit has started.`
                : "Off. A measurement arm can only be added while the bandit is a draft."}
            </div>
          </div>
        )}

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
