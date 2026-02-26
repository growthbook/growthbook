import { useForm, UseFormReturn } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import React from "react";
import { validateAndFixCondition } from "shared/util";
import { Text } from "@radix-ui/themes";
import { useIncrementer } from "@/hooks/useIncrementer";
import { useAuth } from "@/services/auth";
import { useAttributeSchema } from "@/services/features";
import ConditionInput from "@/components//Features/ConditionInput";
import SelectField from "@/components//Forms/SelectField";
import SavedGroupTargetingField, {
  validateSavedGroupTargeting,
} from "@/components/Features/SavedGroupTargetingField";
import Modal from "@/components/Modal";
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

  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const defaultValues = {
    condition: lastPhase?.condition ?? "",
    savedGroups: lastPhase?.savedGroups ?? [],
    coverage: lastPhase?.coverage ?? 1,
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
    <Modal
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
    </Modal>
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
  const attributeSchema = useAttributeSchema(false, experiment.project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const hashAttributeOptions = attributeSchema
    .filter((s) => !hasHashAttributes || s.hashAttribute)
    .map((s) => ({ label: s.property, value: s.property }));

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

  return (
    <div className="pt-2">
      <div className="mb-4">
        <SelectField
          containerClassName="flex-1"
          label="Assign variation based on attribute"
          labelClassName="font-weight-bold"
          options={hashAttributeOptions}
          sort={false}
          value={form.watch("hashAttribute")}
          onChange={(v) => {
            form.setValue("hashAttribute", v);
          }}
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
          <div
            className={`position-relative ${variationInputStyles.percentInputWrap}`}
            style={{ width: 110 }}
          >
            <Field
              style={{ width: 105 }}
              value={
                isNaN(form.watch("coverage") ?? 0)
                  ? "5"
                  : decimalToPercent((form.watch("coverage") ?? 0) / 2)
              }
              onChange={(e) => {
                let decimal = percentToDecimal(e.target.value);
                if (decimal > 1) decimal = 1;
                if (decimal < 0) decimal = 0;
                form.setValue("coverage", decimal * 2);
              }}
              type="number"
              min={0}
              max={100}
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
      <hr />
      <ConditionInput
        defaultValue={form.watch("condition")}
        onChange={(condition) => form.setValue("condition", condition)}
        key={conditionKey}
        project={experiment.project || ""}
      />
    </div>
  );
}
