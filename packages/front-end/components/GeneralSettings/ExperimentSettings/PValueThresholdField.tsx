import { ReactNode } from "react";
import { UseFormRegisterReturn } from "react-hook-form";
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
            : ""
      : "";

  const warningMsg =
    typeof pValueThreshold !== "undefined"
      ? pValueThreshold === 0.5
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

interface PValueThresholdFieldProps {
  value: number | undefined;
  registerProps: UseFormRegisterReturn;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  label?: string;
  helpTextAppend?: ReactNode;
  containerClassName?: string;
}

export default function PValueThresholdField({
  value,
  registerProps,
  min = 0.001,
  max = 0.5,
  step = 0.001,
  disabled = false,
  label = "P-value threshold",
  helpTextAppend,
  containerClassName = "mb-3",
}: PValueThresholdFieldProps) {
  const { highlightColor, warningMsg } = getPValueThresholdHighlight(value);

  return (
    <Field
      label={label}
      type="number"
      step={String(step)}
      min={String(min)}
      max={String(max)}
      style={{
        borderColor: highlightColor,
        backgroundColor: highlightColor ? highlightColor + "15" : "",
      }}
      className="ml-2"
      containerClassName={containerClassName}
      append=""
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
