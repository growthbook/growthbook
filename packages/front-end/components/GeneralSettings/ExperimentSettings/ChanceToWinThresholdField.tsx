import { ReactNode } from "react";
import {
  FieldPath,
  FieldValues,
  RegisterOptions,
  UseFormReturn,
} from "react-hook-form";
import { Flex, Tooltip } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import { GBInfo } from "@/components/Icons";

export function getConfidenceLevelHighlight(percent: number | undefined): {
  highlightColor: string;
  warningMsg: string;
} {
  const highlightColor =
    typeof percent !== "undefined"
      ? percent < 70
        ? "#c73333"
        : percent < 80
          ? "#e27202"
          : percent < 90
            ? "#B39F01"
            : percent >= 100
              ? "#c73333"
              : ""
      : "";

  const warningMsg =
    typeof percent !== "undefined"
      ? percent < 70
        ? "Must be at least 70%"
        : percent === 70
          ? "This is as low as it goes"
          : percent < 75
            ? "Confidence thresholds this low are not recommended"
            : percent < 80
              ? "Confidence thresholds this low are not recommended"
              : percent < 90
                ? "Use caution with values below 90%"
                : percent >= 99
                  ? "Confidence levels 99% and higher can take lots of data to achieve"
                  : percent >= 100
                    ? "Confidence levels 100% and higher are not possible"
                    : ""
      : "";

  return { highlightColor, warningMsg };
}

interface ChanceToWinThresholdFieldProps<
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

export default function ChanceToWinThresholdField<
  TFormValues extends FieldValues,
  TName extends FieldPath<TFormValues>,
>({
  value,
  form,
  name,
  disabled = false,
  label = "Chance to win threshold",
  defaultValue,
  helpTextAppend,
  containerClassName = "mb-3",
  rules,
}: ChanceToWinThresholdFieldProps<TFormValues, TName>) {
  const { highlightColor, warningMsg } = getConfidenceLevelHighlight(value);

  const registerProps = form.register(name, {
    ...rules,
    min: 70,
    max: 99.9999,
  });

  const fieldError = form.formState.errors[name];
  const errorMessage =
    typeof fieldError?.message === "string" ? fieldError.message : undefined;

  return (
    <Field
      size="legacy"
      label={
        <>
          {label}
          <Tooltip content="A variation is called a winner when its chance to win rises above this threshold, and a loser when its chance to win falls below (100% minus this threshold). At 95%, a result is significant when chance to win is above 95% or below 5% -- a one-sided 5% cutoff on each side (z about 1.645 under a flat prior). Use 97.5% to match a two-sided 95% credible interval (z about 1.96).">
            <Flex
              ml="2"
              display="inline-flex"
              style={{ verticalAlign: "middle" }}
            >
              <GBInfo />
            </Flex>
          </Tooltip>
        </>
      }
      type="number"
      step="any"
      min="70"
      max="99.9999"
      placeholder={
        typeof defaultValue === "number" ? String(defaultValue) : undefined
      }
      style={{
        width: "80px",
        borderColor: highlightColor,
        backgroundColor: highlightColor ? highlightColor + "15" : "",
      }}
      className="ml-2"
      containerClassName={containerClassName}
      append="%"
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
