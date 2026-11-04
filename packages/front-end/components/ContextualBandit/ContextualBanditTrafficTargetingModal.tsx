import { contextualBanditEndpoints } from "shared/api-endpoints";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import {
  ApiContextualBanditInterface,
  DEFAULT_MEASUREMENT_ARM_PERCENT,
} from "shared/validators";
import { validateAndFixCondition } from "shared/util";
import { FeaturePrerequisite, SavedGroupTargeting } from "shared/types/feature";
import { Separator } from "@radix-ui/themes";
import { useRestApiCall } from "@/services/restApi";
import { formatPercent } from "@/services/metrics";
import { useEnvironments } from "@/services/features";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import MeasurementArmSizeField, {
  MeasurementArmSizeValue,
} from "@/components/ContextualBandit/MeasurementArmSizeField";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import TargetingFieldsGroup from "@/components/Features/TargetingFieldsGroup";
import ContextualBanditAssignmentAttributeSelect from "@/components/ContextualBandit/ContextualBanditAssignmentAttributeSelect";

type FormValues = {
  coverage: number;
  hashAttribute: string;
  condition: string;
  savedGroups: SavedGroupTargeting[];
  prerequisites: FeaturePrerequisite[];
  measurementArm: MeasurementArmSizeValue;
  variationWeights: number[];
};

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
      measurementArm: {
        enabled: cb.measurementArm?.enabled ?? false,
        percent: cb.measurementArm?.percent ?? DEFAULT_MEASUREMENT_ARM_PERCENT,
      },
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
        submit={validatedSubmit(form, async (data) => {
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
                ? { measurementArm: data.measurementArm }
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
          // Coverage only: the bandit manages the weights.
          hideVariations
        />

        <Separator size="4" my="4" />

        {cb.status === "draft" ? (
          <MeasurementArmSizeField
            value={form.watch("measurementArm")}
            onChange={(value) => form.setValue("measurementArm", value)}
          />
        ) : (
          <div>
            <Text as="div" weight="semibold" mb="1">
              Measurement arm
            </Text>
            <Text as="div" color="text-mid">
              {cb.measurementArm?.enabled
                ? `${formatPercent(cb.measurementArm.percent)} of eligible users are held back on the default experience. This is locked once the Bandit has started.`
                : "Off. A measurement arm can only be added while the Bandit is a draft."}
            </Text>
          </div>
        )}

        <Separator size="4" my="4" />

        <ContextualBanditAssignmentAttributeSelect project={cb.project} />

        <Separator size="4" my="4" />

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
