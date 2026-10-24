import { useForm, UseFormReturn } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import React from "react";
import {
  coverageToHoldoutSize,
  holdoutSizeToCoverage,
  MAX_HOLDOUT_SIZE,
  validateAndFixCondition,
} from "shared/util";
import { Text, Separator } from "@radix-ui/themes";
import { useIncrementer } from "@/hooks/useIncrementer";
import { useAuth } from "@/services/auth";
import ConditionInput from "@/components//Features/ConditionInput";
import SelectField from "@/components//Forms/SelectField";
import { formatAttributeOptionLabel } from "@/components/Features/AttributeOptionTooltip";
import useHashAttributeOptions from "@/components/Experiment/useHashAttributeOptions";
import SavedGroupTargetingField, {
  validateSavedGroupTargeting,
} from "@/components/Features/SavedGroupTargetingField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import track from "@/services/track";
import variationInputStyles from "@/components/Features/VariationsInput.module.scss";
import { decimalToPercent, percentToDecimal } from "@/services/utils";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}

export default function EditHoldoutTargetingModal({
  close,
  experiment,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const [conditionKey, forceConditionRender] = useIncrementer();

  const mainPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[0];

  const defaultValues = {
    condition: mainPhase?.condition ?? "",
    savedGroups: mainPhase?.savedGroups ?? [],
    coverage: mainPhase?.coverage ?? 1,
    hashAttribute: experiment.hashAttribute || "id",
  };

  const form = useForm<ExperimentTargetingData>({
    defaultValues,
  });

  const onSubmit = form.handleSubmit(async (value) => {
    validateSavedGroupTargeting(value.savedGroups);

    validateAndFixCondition(value.condition, (condition) => {
      form.setValue("condition", condition);
      forceConditionRender();
    });

    await apiCall(`/experiment/${experiment.id}/targeting`, {
      method: "POST",
      body: JSON.stringify(value),
    });
    mutate();
    track("edit-holdout-targeting");
  });

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      header={`Edit Targeting`}
      submit={onSubmit}
      cta="Save"
      size="lg"
    >
      <TargetingForm
        experiment={experiment}
        form={form}
        conditionKey={conditionKey}
      />
    </ModalStandard>
  );
}

function TargetingForm({
  experiment,
  form,
  conditionKey,
}: {
  experiment: ExperimentInterfaceStringDates;
  form: UseFormReturn<ExperimentTargetingData>;
  conditionKey: number;
}) {
  const hashAttributeOptions = useHashAttributeOptions(
    experiment.project,
    form.watch("hashAttribute"),
  );

  return (
    <div className="pt-2">
      <div className="mb-4">
        <SelectField
          withRadixThemedPortal
          containerClassName="flex-1"
          label="Assign variation based on attribute"
          options={hashAttributeOptions}
          sort={false}
          value={form.watch("hashAttribute")}
          onChange={(v) => {
            form.setValue("hashAttribute", v);
          }}
          formatOptionLabel={formatAttributeOptionLabel}
          helpText={"The globally unique tracking key for the experiment"}
        />

        <div>
          <Text as="label" size="2" weight="medium">
            Holdout Size
            <Text size="1" as="div" weight="regular" color="gray">
              Enter the percent of traffic that you would like to be in the
              holdout. The same amount of traffic will be in the control.
            </Text>
          </Text>
          <div className={variationInputStyles.percentInputWrap}>
            <Field
              size="legacy"
              style={{ width: 105 }}
              value={
                isNaN(form.watch("coverage") ?? 0)
                  ? "5"
                  : decimalToPercent(
                      coverageToHoldoutSize(form.watch("coverage") ?? 0),
                    )
              }
              onChange={(e) => {
                let holdoutSize = percentToDecimal(e.target.value);
                if (holdoutSize > MAX_HOLDOUT_SIZE)
                  holdoutSize = MAX_HOLDOUT_SIZE;
                if (holdoutSize < 0) holdoutSize = 0;
                form.setValue("coverage", holdoutSizeToCoverage(holdoutSize));
              }}
              type="number"
              min={0}
              max={decimalToPercent(MAX_HOLDOUT_SIZE)}
              step="1"
            />
            <span>%</span>
          </div>
        </div>
      </div>

      <SavedGroupTargetingField
        value={form.watch("savedGroups") || []}
        setValue={(v) => form.setValue("savedGroups", v)}
        project={experiment.project || ""}
      />
      <Separator size="4" my="5" />
      <ConditionInput
        defaultValue={form.watch("condition")}
        onChange={(condition) => form.setValue("condition", condition)}
        key={conditionKey}
        project={experiment.project || ""}
      />
    </div>
  );
}
