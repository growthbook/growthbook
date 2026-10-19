import { useEffect, useState } from "react";
import { Box } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import {
  capTypedPercent,
  COVERAGE_DECIMALS,
  coverageFromPercent,
  coverageToPercent,
  decimalToPercent,
  percentToDecimal,
} from "@/services/utils";
import Text from "@/ui/Text";
import styles from "@/components/Features/VariationsInput.module.scss";
import own from "./PercentSliderField.module.scss";

export interface Props {
  /** The share, as a decimal between 0 and 1. */
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
  /**
   * "blur" holds what is typed until the field is left, for a field whose
   * change moves the other fields around it. "change" reports every keystroke.
   */
  commitOn?: "change" | "blur";
  /** Whole percentages by default; "any" takes fractions. */
  step?: number | "any";
  decimals?: number;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** A percentage in a field that carries its own "%". */
export function PercentField({
  value,
  onChange,
  disabled,
  ariaLabel,
  commitOn = "change",
  step = 1,
  decimals,
}: Props) {
  const percent = isNaN(value)
    ? ""
    : decimals === undefined
      ? coverageToPercent(value)
      : decimalToPercent(value, decimals + 2);
  // Only used with commitOn="blur".
  const [typed, setTyped] = useState<string | number>(percent);
  useEffect(() => setTyped(percent), [percent]);

  const onBlurCommit = commitOn === "blur";
  const cap = (raw: string) =>
    capTypedPercent(raw, decimals ?? COVERAGE_DECIMALS);
  const commit = (raw: string) =>
    onChange(
      clamp(
        decimals === undefined
          ? coverageFromPercent(raw)
          : percentToDecimal(raw, decimals + 2),
      ),
    );

  return (
    <Box
      position="relative"
      display="inline-block"
      className={`${styles.percentInputWrapMd} ${own.field}`}
    >
      <Field
        size="md"
        disabled={disabled}
        value={onBlurCommit ? typed : percent}
        onChange={(e) =>
          onBlurCommit
            ? setTyped(cap(e.target.value))
            : commit(cap(e.target.value))
        }
        onBlur={onBlurCommit ? (e) => commit(e.target.value) : undefined}
        type="number"
        min={0}
        max={100}
        step={step}
        aria-label={ariaLabel}
      />
      <Text as="span">%</Text>
    </Box>
  );
}
