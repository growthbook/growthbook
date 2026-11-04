import { Box } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import {
  ContextualBanditMeasurementArm,
  MAX_MEASUREMENT_ARM_PERCENT,
  MIN_MEASUREMENT_ARM_PERCENT,
} from "shared/validators";
import { decimalToPercent, percentToDecimalForNumber } from "@/services/utils";
import Switch from "@/ui/Switch";
import TextField from "@/ui/TextField";

export type MeasurementArmSizeValue = Pick<
  ContextualBanditMeasurementArm,
  "enabled" | "percent"
>;

const MIN_PERCENT = decimalToPercent(MIN_MEASUREMENT_ARM_PERCENT);
const MAX_PERCENT = decimalToPercent(MAX_MEASUREMENT_ARM_PERCENT);

function parsePercent(text: string): number | null {
  const pct = Number(text);
  return text.trim() === "" || isNaN(pct) ? null : pct;
}

export default function MeasurementArmSizeField({
  value,
  onChange,
}: {
  value: MeasurementArmSizeValue;
  onChange: (value: MeasurementArmSizeValue) => void;
}) {
  const [draft, setDraft] = useState(String(decimalToPercent(value.percent)));
  useEffect(() => {
    setDraft(String(decimalToPercent(value.percent)));
  }, [value.percent]);
  const parsed = parsePercent(draft);
  const outOfRange =
    parsed !== null && (parsed < MIN_PERCENT || parsed > MAX_PERCENT);

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
            error={
              outOfRange
                ? `Enter a value between ${MIN_PERCENT}% and ${MAX_PERCENT}%`
                : undefined
            }
            type="number"
            append="%"
            style={{ width: 110 }}
            min={MIN_PERCENT}
            max={MAX_PERCENT}
            step="any"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              const pct = parsePercent(e.target.value);
              if (pct === null || pct < MIN_PERCENT || pct > MAX_PERCENT) {
                return;
              }
              onChange({ ...value, percent: percentToDecimalForNumber(pct) });
            }}
            onBlur={() => {
              const pct = parsePercent(draft);
              const clamped =
                pct === null
                  ? decimalToPercent(value.percent)
                  : Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, pct));
              setDraft(String(clamped));
              onChange({
                ...value,
                percent: percentToDecimalForNumber(clamped),
              });
            }}
          />
        </Box>
      ) : null}
    </Box>
  );
}
