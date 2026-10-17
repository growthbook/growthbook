import { useEffect, useState } from "react";
import { Box, Slider } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import { decimalToPercent, percentToDecimal } from "@/services/utils";
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
}: Props) {
  const percent = isNaN(value) ? "" : decimalToPercent(value);
  // Only used with commitOn="blur".
  const [typed, setTyped] = useState<string | number>(percent);
  useEffect(() => setTyped(percent), [percent]);

  const onBlurCommit = commitOn === "blur";
  const commit = (raw: string) => onChange(clamp(percentToDecimal(raw)));

  return (
    <Box
      position="relative"
      display="inline-block"
      className={`${styles.percentInputWrapMd} ${own.autoWidth}`}
    >
      <Field
        size="md"
        disabled={disabled}
        value={onBlurCommit ? typed : percent}
        onChange={(e) =>
          onBlurCommit ? setTyped(e.target.value) : commit(e.target.value)
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

/** The same value as a 0-100 slider. */
export function PercentSlider({ value, onChange, disabled, ariaLabel }: Props) {
  return (
    <Slider
      value={[isNaN(value) ? 0 : decimalToPercent(value)]}
      min={0}
      max={100}
      step={1}
      disabled={disabled}
      aria-label={ariaLabel}
      onValueChange={(e) => onChange(clamp(e[0] / 100))}
    />
  );
}
