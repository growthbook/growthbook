import { ReactNode } from "react";
import {
  FieldPath,
  FieldValues,
  RegisterOptions,
  UseFormReturn,
} from "react-hook-form";
import Field from "@/components/Forms/Field";

export function getPValueThresholdHighlight(
  pValueThreshold: number | undefined,
): {
  highlightColor: string;
  warningMsg: string;
} {
  const highlightColor =
    typeof pValueThreshold !== "undefined"
      ? pValueThreshold > 0.3
        ? "#c73333"
        : pValueThreshold > 0.2
          ? "#e27202"
          : pValueThreshold > 0.1
            ? "#B39F01"
            : pValueThreshold <= 0.01
              ? "#c73333"
              : ""
      : "";

  const warningMsg =
    typeof pValueThreshold !== "undefined"
      ? pValueThreshold <= 0
        ? "Threshold values of 0 and lower are not possible"
        : pValueThreshold === 0.5
          ? "This is as high as it goes"
          : pValueThreshold > 0.25
            ? "P-value thresholds this high are not recommended"
            : pValueThreshold > 0.2
              ? "P-value thresholds this high are not recommended"
              : pValueThreshold > 0.1
                ? "Use caution with values above 0.1"
                : pValueThreshold <= 0.01
                  ? "Threshold values of 0.01 and lower can take lots of data to achieve"
                  : ""
      : "";

  return { highlightColor, warningMsg };
}

interface PValueThresholdFieldProps<
  TFormValues extends FieldValues,
  TName extends FieldPath<TFormValues>,
> {
  value: number | undefined;
  form: UseFormReturn<TFormValues>;
  name: TName;
  disabled?: boolean;
  label?: string;
  defaultValue?: number;
  helpTextAppend?: ReactNode;
  containerClassName?: string;
  rules?: Omit<RegisterOptions<TFormValues, TName>, "min" | "max">;
}

export default function PValueThresholdField<
  TFormValues extends FieldValues,
  TName extends FieldPath<TFormValues>,
>({
  value,
  form,
  name,
  disabled = false,
  label = "P-value threshold",
  defaultValue,
  helpTextAppend,
  containerClassName = "mb-3",
  rules,
}: PValueThresholdFieldProps<TFormValues, TName>) {
  const { highlightColor, warningMsg } = getPValueThresholdHighlight(value);

  const registerProps = form.register(name, {
    ...rules,
    min: 0,
    max: 0.5,
    validate: (v) => typeof v === "undefined" || v > 0,
  });

  const fieldError = form.formState.errors[name];
  const errorMessage =
    typeof fieldError?.message === "string" ? fieldError.message : undefined;

  return (
    <Field
      label={label}
      type="number"
      step="0.001"
      min="0"
      max="0.5"
      placeholder={
        typeof defaultValue === "number" ? String(defaultValue) : undefined
      }
      style={{
        borderColor: highlightColor,
        backgroundColor: highlightColor ? highlightColor + "15" : "",
      }}
      className="ml-2"
      containerClassName={containerClassName}
      append=""
      disabled={disabled}
      error={errorMessage}
      helpText={
        <>
          {helpTextAppend}
          <div
            className="ml-2"
            style={{
              color: highlightColor,
              flexBasis: "100%",
            }}
          >
            {warningMsg}
          </div>
        </>
      }
      {...registerProps}
    />
  );
}
