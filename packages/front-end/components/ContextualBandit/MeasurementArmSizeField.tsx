import { Box } from "@radix-ui/themes";
import {
  ContextualBanditMeasurementArm,
  MAX_MEASUREMENT_ARM_PERCENT,
  MIN_MEASUREMENT_ARM_PERCENT,
} from "shared/validators";
import { decimalToPercent, percentToDecimal } from "@/services/utils";
import Switch from "@/ui/Switch";
import TextField from "@/ui/TextField";

export type MeasurementArmSizeValue = Pick<
  ContextualBanditMeasurementArm,
  "enabled" | "percent"
>;

export default function MeasurementArmSizeField({
  value,
  onChange,
}: {
  value: MeasurementArmSizeValue;
  onChange: (value: MeasurementArmSizeValue) => void;
}) {
  return (
    <Box>
      <Switch
        label="Add a measurement arm"
        description="Hold back a share of eligible traffic on the default experience and compare it against the Bandit on the Results tab. Locked once the Bandit starts."
        value={value.enabled}
        onChange={(enabled) => onChange({ ...value, enabled })}
      />
      {value.enabled ? (
        <Box mt="3">
          <TextField
            label="Measurement arm size"
            helpText="Percent of eligible traffic held back from the Bandit."
            type="number"
            append="%"
            style={{ width: 110 }}
            min={decimalToPercent(MIN_MEASUREMENT_ARM_PERCENT)}
            max={decimalToPercent(MAX_MEASUREMENT_ARM_PERCENT)}
            step={1}
            value={decimalToPercent(value.percent)}
            onChange={(e) => {
              const pct = percentToDecimal(e.target.value);
              if (isNaN(pct)) return;
              onChange({
                ...value,
                percent: Math.min(
                  MAX_MEASUREMENT_ARM_PERCENT,
                  Math.max(MIN_MEASUREMENT_ARM_PERCENT, pct),
                ),
              });
            }}
          />
        </Box>
      ) : null}
    </Box>
  );
}
