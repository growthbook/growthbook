import { ReactNode } from "react";
import { UseFormRegisterReturn } from "react-hook-form";
import Field from "@/components/Forms/Field";

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
            : ""
      : "";

  const warningMsg =
    typeof percent !== "undefined"
      ? percent === 70
        ? "This is as low as it goes"
        : percent < 75
          ? "Confidence thresholds this low are not recommended"
          : percent < 80
            ? "Confidence thresholds this low are not recommended"
            : percent < 90
              ? "Use caution with values below 90%"
              : percent >= 99
                ? "Confidence levels 99% and higher can take lots of data to achieve"
                : ""
      : "";

  return { highlightColor, warningMsg };
}

interface ChanceToWinThresholdFieldProps {
  value: number | undefined;
  registerProps: UseFormRegisterReturn;
  min?: number;
  max?: number;
  disabled?: boolean;
  label?: string;
  helpTextAppend?: ReactNode;
  containerClassName?: string;
}

export default function ChanceToWinThresholdField({
  value,
  registerProps,
  min = 50,
  max = 99,
  disabled = false,
  label = "Chance to win threshold",
  helpTextAppend,
  containerClassName = "mb-3",
}: ChanceToWinThresholdFieldProps) {
  const { highlightColor, warningMsg } = getConfidenceLevelHighlight(value);

  return (
    <Field
      label={label}
      type="number"
      step="any"
      min={String(min)}
      max={String(max)}
      style={{
        width: "80px",
        borderColor: highlightColor,
        backgroundColor: highlightColor ? highlightColor + "15" : "",
      }}
      className="ml-2"
      containerClassName={containerClassName}
      append="%"
      disabled={disabled}
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
