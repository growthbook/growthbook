import { useState } from "react";
import { Box } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import {
  capTypedPercent,
  COVERAGE_DECIMALS,
  decimalToPercent,
  percentToDecimal,
} from "@/services/utils";
import Text from "@/ui/Text";
import styles from "@/components/Features/VariationsInput.module.scss";
import own from "./PercentSliderField.module.scss";

export interface Props {
  // A decimal between 0 and 1.
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
  // "blur" holds what is typed until the field is left, for a field whose
  // change moves the fields around it.
  commitOn?: "change" | "blur";
  decimals?: number;
  // The form whose check refuses it empty, when that isn't the one it's in.
  form?: string;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

// A percentage in a field that carries its own "%".
export function PercentField({
  value,
  onChange,
  disabled,
  ariaLabel,
  commitOn = "change",
  decimals = COVERAGE_DECIMALS,
  form,
}: Props) {
  const percent = isNaN(value) ? "" : decimalToPercent(value, decimals + 2);
  // What's typed but not yet committed, with commitOn="blur".
  const [typed, setTyped] = useState<string | null>(null);

  const onBlurCommit = commitOn === "blur";
  const cap = (raw: string) => capTypedPercent(raw, decimals);
  const commit = (raw: string) =>
    onChange(clamp(percentToDecimal(raw, decimals + 2)));

  return (
    <Box
      position="relative"
      display="inline-block"
      className={`${styles.percentInputWrapMd} ${own.field}`}
    >
      <Field
        size="md"
        disabled={disabled}
        value={onBlurCommit ? (typed ?? percent) : percent}
        onChange={(e) =>
          onBlurCommit
            ? setTyped(cap(e.target.value))
            : commit(cap(e.target.value))
        }
        onBlur={
          onBlurCommit
            ? (e) => {
                // Tabbing through commits nothing, or a stored value with more
                // precision than shown would come back rounded.
                if (typed !== null) commit(e.target.value);
                setTyped(null);
              }
            : undefined
        }
        type="number"
        required
        form={form}
        min={0}
        max={100}
        // Fractions are allowed, so a stored one is never refused; the arrows
        // still step by 1.
        step="any"
        aria-label={ariaLabel}
      />
      <Text as="span">%</Text>
    </Box>
  );
}
