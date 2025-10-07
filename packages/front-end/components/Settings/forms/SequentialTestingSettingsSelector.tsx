
import { ScopedSettings } from "shared/settings";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import Field from "@/components/Forms/Field";
import { UseFormReturn } from "react-hook-form";
import { AnalysisFormValues } from "@/components/Experiment/AnalysisForm";

export default function SequentialTestingSettingsSelector({
  form,
  disabled,
  parentSettings,
}: {
  form: UseFormReturn<AnalysisFormValues>;
  parentSettings?: ScopedSettings;
  disabled?: boolean;
}) {

  const parentTuningParameter = (
    parentSettings?.sequentialTestingSettings.value.type === "standard" && parentSettings.sequentialTestingSettings.value.tuningParameter
  ) || DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
  const type = form.watch("sequentialTestingSettings.type");

  return <>
    {type === "standard" || type === "hybrid" ? (
    <Field
        label="Tuning parameter"
        type="number"
        min="0"
        style={{ width: 200 }}
        disabled={disabled}
        // TODO sort out hasFileConfig
        // hasFileConfig()
        helpText={
        <>
            <span className="ml-2">
            (
            {parentTuningParameter}{" "}
            is default)
            </span>
        </>
        }
        {...form.register("sequentialTestingSettings.tuningParameter", {
        valueAsNumber: true,
        validate: (v) => {
            return !((v ?? 0) <= 0);
        },
        })}
    />
    ) : null}
    </>;
    {/* todo: add hybrid customization */}
    {/* {realizedValue === "hybrid" ? (
    <Field
    label="Tuning parameter"
    type="number"
    containerClassName="mb-0"
    min="0"
    disabled={disabled}
    // usingSequentialTestingDefault ||
    // !hasSequentialTestingFeature ||
    // hasFileConfig()
    helpText={
    <>
        <span className="ml-2">
        (
        {parentTuningParameter}{" "}
        is default)
        </span>
    </>
    }
    {...form.register("sequentialTestingReservedAlphaProportion", {
    valueAsNumber: true,
    validate: (v) => {
        return !((v ?? 0) <= 0) && !((v ?? 0) >= 1);
    },
    })}
/>
    ) : null} */}
}
