import { FC, useEffect, useState } from "react";
import {
  addDays,
  allowedExpirationPresets,
  maxExpirationDate,
  MaxLifetimeDays,
  violatesExpirationPolicy,
} from "shared/api-key-expiration";
import { datetime } from "shared/dates";
import DatePicker from "@/components/DatePicker";
import { Select, SelectItem, SelectSeparator } from "@/ui/Select";
import HelperText from "@/ui/HelperText";

const CUSTOM = "custom";
const NEVER = "never";
// Nothing selected, which only a policy change can put the field into.
const UNSET = "";

const presetLabel = (days: number) => {
  if (days === 365) return "1 year";
  if (days % 30 === 0 && days >= 60) return `${days / 30} months`;
  return `${days} day${days === 1 ? "" : "s"}`;
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
  const longest = presets[presets.length - 1];
  const required = (maxLifetimeDays ?? null) !== null;
  const [selection, setSelection] = useState<string>(() =>
    value ? CUSTOM : required ? String(longest) : NEVER,
  );

  // The select shows a default under a policy, but the parent owns the value, so
  // without this a key created without touching the dropdown submits null.
  useEffect(() => {
    if (!required) return;
    // A policy can tighten mid-modal. Clearing rather than clamping keeps Create
    // from submitting a date the user never saw.
    if (value && violatesExpirationPolicy(value, maxLifetimeDays)) {
      setSelection(UNSET);
      setValue(null);
      return;
    }
    if (value || selection === CUSTOM || selection === UNSET) return;
    // A policy turning on strands a selection the select no longer offers —
    // converting that one gives an invalid date.
    const days = selection === NEVER ? longest : Number(selection);
    setSelection(String(days));
    setValue(addDays(new Date(), days));
  }, [required, value, selection, longest, maxLifetimeDays, setValue]);

  const latest = maxExpirationDate(maxLifetimeDays);
  const cleared = selection === UNSET;

  return (
    <>
      <Select
        label="Expiration"
        mb="3"
        placeholder="Choose an expiration"
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
        <SelectSeparator />
        <SelectItem value={CUSTOM}>Custom</SelectItem>
        {/* Offering "no expiration" under a policy would only ever be rejected. */}
        {!required && <SelectItem value={NEVER}>No expiration</SelectItem>}
      </Select>

      {selection === CUSTOM && (
        <DatePicker
          label="Expiration date"
          date={value ?? undefined}
          setDate={(d) => setValue(d ?? null)}
          precision="date"
          disableBefore={addDays(new Date(), 1)}
          disableAfter={latest ?? undefined}
        />
      )}

      {required && latest && (
        <HelperText status={cleared ? "warning" : "info"} mb="3">
          {cleared
            ? `Your organization changed its expiration policy, so the date you chose is no longer allowed. The latest allowed is now ${datetime(latest)}.`
            : `Your organization requires an expiration date, and the latest allowed is ${datetime(latest)}.`}
        </HelperText>
      )}
    </>
  );
};

export default ApiKeyExpirationField;
