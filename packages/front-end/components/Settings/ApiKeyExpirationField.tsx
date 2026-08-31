import { FC, useState } from "react";
import {
  addDays,
  allowedExpirationPresets,
  maxExpirationDate,
  MaxLifetimeDays,
} from "shared/api-key-expiration";
import { datetime } from "shared/dates";
import DatePicker from "@/components/DatePicker";
import { Select, SelectItem } from "@/ui/Select";
import HelperText from "@/ui/HelperText";

const CUSTOM = "custom";
const NEVER = "never";

const presetLabel = (days: number) => {
  if (days === 365) return "1 year";
  if (days % 30 === 0 && days >= 60) return `${days / 30} months`;
  return `${days} days`;
};

/**
 * Duration picker for a new key. A resolved date is what gets stored, not the
 * duration, so the meaning can't shift if the policy changes later.
 */
const ApiKeyExpirationField: FC<{
  maxLifetimeDays: MaxLifetimeDays;
  value: Date | null;
  setValue: (date: Date | null) => void;
}> = ({ maxLifetimeDays, value, setValue }) => {
  const presets = allowedExpirationPresets(maxLifetimeDays);
  const required = (maxLifetimeDays ?? null) !== null;
  const [selection, setSelection] = useState<string>(() =>
    value ? CUSTOM : required ? String(presets[presets.length - 1]) : NEVER,
  );

  const latest = maxExpirationDate(maxLifetimeDays);

  return (
    <>
      <Select
        label="Expiration"
        value={selection}
        setValue={(next) => {
          setSelection(next);
          if (next === NEVER) {
            setValue(null);
          } else if (next !== CUSTOM) {
            setValue(addDays(new Date(), Number(next)));
          }
        }}
      >
        {presets.map((days) => (
          <SelectItem key={days} value={String(days)}>
            {presetLabel(days)}
          </SelectItem>
        ))}
        <SelectItem value={CUSTOM}>Custom</SelectItem>
        {/* Offering "no expiration" under a policy would only ever be rejected. */}
        {!required && <SelectItem value={NEVER}>No expiration</SelectItem>}
      </Select>

      {selection === CUSTOM && (
        <DatePicker
          date={value ?? undefined}
          setDate={(d) => setValue(d ?? null)}
          precision="date"
          disableBefore={addDays(new Date(), 1)}
          disableAfter={latest ?? undefined}
          containerClassName="mb-2"
        />
      )}

      {required && latest && (
        <HelperText status="info" mb="3">
          {`Your organization requires an expiration date, and the latest allowed is ${datetime(latest)}.`}
        </HelperText>
      )}
    </>
  );
};

export default ApiKeyExpirationField;
