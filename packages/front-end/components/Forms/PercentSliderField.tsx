import { Box, Flex, Slider } from "@radix-ui/themes";
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
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** The typed half: a percentage in a field that carries its own "%". */
export function PercentField({ value, onChange, disabled, ariaLabel }: Props) {
  return (
    <Box
      position="relative"
      display="inline-block"
      className={`${styles.percentInputWrapMd} ${own.autoWidth}`}
    >
      <Field
        size="md"
        disabled={disabled}
        value={isNaN(value ?? 0) ? "" : decimalToPercent(value ?? 0)}
        onChange={(e) => onChange(clamp(percentToDecimal(e.target.value)))}
        type="number"
        min={0}
        max={100}
        step="1"
        aria-label={ariaLabel}
      />
      <Text as="span">%</Text>
    </Box>
  );
}

/** The dragged half, on the same 0-100 scale. */
export function PercentSlider({ value, onChange, disabled, ariaLabel }: Props) {
  return (
    <Slider
      value={[isNaN(value ?? 0) ? 0 : decimalToPercent(value ?? 0)]}
      min={0}
      max={100}
      step={1}
      disabled={disabled}
      aria-label={ariaLabel}
      onValueChange={(e) => onChange(clamp(e[0] / 100))}
    />
  );
}

/** A percentage set either by dragging or by typing, the two kept in step. */
export default function PercentSliderField({
  value,
  onChange,
  disabled,
  ariaLabel,
}: Props) {
  return (
    <Flex align="center" gap="3">
      <Box flexGrow="1">
        <PercentSlider
          value={value}
          onChange={onChange}
          disabled={disabled}
          ariaLabel={ariaLabel}
        />
      </Box>
      <PercentField
        value={value}
        onChange={onChange}
        disabled={disabled}
        ariaLabel={ariaLabel}
      />
    </Flex>
  );
}
