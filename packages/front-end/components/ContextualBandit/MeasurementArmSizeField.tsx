import {
  MAX_MEASUREMENT_ARM_PERCENT,
  MIN_MEASUREMENT_ARM_PERCENT,
} from "shared/validators";
import { decimalToPercent, percentToDecimal } from "@/services/utils";
import TextField from "@/ui/TextField";

export type MeasurementArmSizeValue = {
  enabled: boolean;
  percent: number;
};

export default function MeasurementArmSizeField({
  value,
  onChange,
}: {
  value: MeasurementArmSizeValue;
  onChange: (value: MeasurementArmSizeValue) => void;
}) {
  return (
    <TextField
      label="Measurement arm size"
      helpText="Enter the percent of eligible traffic to hold back from the Bandit on the default experience. The rest of the traffic goes to the Bandit, and the two are compared on the Results tab. Set to 0 for no measurement arm. Locked once the Bandit starts."
      type="number"
      append="%"
      style={{ width: 110 }}
      min={0}
      max={decimalToPercent(MAX_MEASUREMENT_ARM_PERCENT)}
      step={1}
      value={value.enabled ? decimalToPercent(value.percent) : 0}
      onChange={(e) => {
        const pct = percentToDecimal(e.target.value);
        if (isNaN(pct) || pct <= 0) {
          onChange({ enabled: false, percent: value.percent });
          return;
        }
        onChange({
          enabled: true,
          percent: Math.min(
            MAX_MEASUREMENT_ARM_PERCENT,
            Math.max(MIN_MEASUREMENT_ARM_PERCENT, pct),
          ),
        });
      }}
    />
  );
}
