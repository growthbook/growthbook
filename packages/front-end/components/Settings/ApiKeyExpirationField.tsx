import { FC, useEffect, useRef, useState } from "react";
import {
  addDays,
  allowedExpirationPresets,
  EXPIRATION_PRESET_DAYS,
  ExpiresAt,
  getExpirationProblem,
  isExpired,
  latestEditedExpiration,
  maxExpirationDate,
  MaxLifetimeDays,
  violatesExpirationPolicy,
} from "shared/api-key-expiration";
import { date, datetimeAt } from "shared/dates";
import { Box, Grid } from "@radix-ui/themes";
import DatePicker from "@/components/DatePicker";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import { Select, SelectItem, SelectSeparator } from "@/ui/Select";
import Text from "@/ui/Text";

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
 * Duration picker for a new or existing key. A resolved date is what gets
 * stored, not the duration, so the meaning can't shift if the policy changes.
 */
const ApiKeyExpirationField: FC<{
  maxLifetimeDays: MaxLifetimeDays;
  value: Date | null;
  setValue: (date: Date | null) => void;
  /** The key being edited, whose policy maximum runs from its creation. */
  existing?: { expiresAt?: ExpiresAt; dateCreated: ExpiresAt };
}> = ({ maxLifetimeDays, value, setValue, existing }) => {
  const required = (maxLifetimeDays ?? null) !== null;
  const latest = existing
    ? latestEditedExpiration(
        existing.expiresAt,
        existing.dateCreated,
        maxLifetimeDays,
      )
    : maxExpirationDate(maxLifetimeDays);
  const presets = existing
    ? EXPIRATION_PRESET_DAYS.filter(
        (days) => !latest || addDays(new Date(), days) <= latest,
      )
    : allowedExpirationPresets(maxLifetimeDays);
  const longest = presets[presets.length - 1];
  const [selection, setSelection] = useState<string>(() =>
    value ? CUSTOM : required && !existing ? String(longest) : NEVER,
  );

  const appliedPolicy = useRef(maxLifetimeDays);

  // The select shows a default under a policy, but the parent owns the value, so
  // without this a key created without touching the dropdown submits null.
  useEffect(() => {
    // An edit starts from the key's own expiry, which may predate the policy.
    if (!required || existing) return;
    // Only when the policy itself tightens — a date the user typed past the
    // maximum is theirs to correct, and is flagged on the field instead.
    const policyChanged = appliedPolicy.current !== maxLifetimeDays;
    appliedPolicy.current = maxLifetimeDays;
    if (
      policyChanged &&
      value &&
      violatesExpirationPolicy(value, maxLifetimeDays)
    ) {
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
  }, [
    required,
    existing,
    value,
    selection,
    longest,
    maxLifetimeDays,
    setValue,
  ]);

  const expired = !!existing && isExpired(existing.expiresAt);
  const cleared = selection === UNSET;
  // Typed dates aren't snapped onto the bounds, so an out-of-range one is
  // flagged here instead of silently becoming a date the user never chose.
  const problem = getExpirationProblem(
    value,
    maxLifetimeDays,
    new Date(),
    latest,
  );
  const dateError =
    problem === "past"
      ? "Enter or select a future date."
      : problem === "too-late" && latest
        ? `Enter or select a date on or before ${date(latest)}.`
        : undefined;
  const expiresNote =
    value && !problem ? (
      <HelperText status="info">{`Expires ${datetimeAt(value)}.`}</HelperText>
    ) : null;

  return (
    <Box mt="6">
      <Heading as="h4" size="sm" mb="1">
        Expiration
      </Heading>
      {expired ? (
        <HelperText status="warning">
          This key has expired and can&apos;t be extended. Create a new key to
          replace it.
        </HelperText>
      ) : (
        <>
          {/* Day precision to match the picker; the exact moment shows beside it once chosen. */}
          {required && latest && (
            <HelperText status={cleared ? "warning" : "info"} mb="3">
              {cleared
                ? `Your organization changed its expiration policy, so the date you chose is no longer allowed. The latest allowed is now ${date(latest)}.`
                : existing
                  ? `Your organization's ${maxLifetimeDays}-day maximum counts from when this key was created, so the latest allowed is ${date(latest)}.`
                  : `Your organization requires an expiration date, and the latest allowed is ${date(latest)}.`}
            </HelperText>
          )}
          <Frame py="1" px="3">
            <Grid
              columns="100px 210px 1fr"
              gapX="4"
              align="center"
              style={{ gridAutoRows: "minmax(40px, auto)" }}
            >
              <Text as="label" weight="semibold" mb="0">
                Expires
              </Text>
              <Select
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
                {/* Offered under a policy only as the edited key's unchanged state. */}
                {(!required || (existing && !existing.expiresAt)) && (
                  <SelectItem value={NEVER}>No expiration</SelectItem>
                )}
              </Select>
              <Box>{selection !== CUSTOM && expiresNote}</Box>
              {selection === CUSTOM && (
                <>
                  <Text as="label" weight="semibold" mb="0">
                    Date
                  </Text>
                  <DatePicker
                    size="md"
                    date={value ?? undefined}
                    setDate={(d) => setValue(d ?? null)}
                    precision="date"
                    disableBefore={addDays(new Date(), 1)}
                    disableAfter={latest ?? undefined}
                    clampInput={false}
                    error={dateError}
                    containerClassName=""
                  />
                  <Box>{expiresNote}</Box>
                </>
              )}
            </Grid>
          </Frame>
        </>
      )}
    </Box>
  );
};

export default ApiKeyExpirationField;
