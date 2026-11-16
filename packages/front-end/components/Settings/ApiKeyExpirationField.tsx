import { FC, useEffect, useId, useRef, useState } from "react";
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
import { Box, Flex } from "@radix-ui/themes";
import DatePicker from "@/components/DatePicker";
import HelperText from "@/ui/HelperText";
import SelectField from "@/components/Forms/SelectField";
import Text from "@/ui/Text";

const DATE = "date";
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
  /** The key being edited, whose policy maximum runs from when its secret was issued. */
  existing?: {
    expiresAt?: ExpiresAt;
    dateCreated: ExpiresAt;
    keyIssuedAt?: ExpiresAt;
  };
  /** Why the viewer can't create a replacement for an expired key, or null when they can. */
  replaceBlocked: string | null;
}> = ({ maxLifetimeDays, value, setValue, existing, replaceBlocked }) => {
  const required = (maxLifetimeDays ?? null) !== null;
  const latest = existing
    ? latestEditedExpiration(
        existing.expiresAt,
        existing.keyIssuedAt ?? existing.dateCreated,
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
    value ? DATE : required && !existing ? String(longest) : NEVER,
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
    if (value || selection === DATE || selection === UNSET) return;
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
  const picksDate = selection === DATE;
  const dateId = useId();
  // A preset only says how long; this turns it into the date it lands on.
  const expiresNote =
    value && !problem && !picksDate ? (
      <Text
        size="sm"
        color="text-mid"
        mt="1"
      >{`Expires ${datetimeAt(value)}.`}</Text>
    ) : null;

  const notice = expired ? (
    <HelperText status="warning">
      This key has expired and can&apos;t be extended.{" "}
      {replaceBlocked ?? "Create a new key to replace it."}
    </HelperText>
  ) : required && latest ? (
    // Day precision to match the picker.
    <HelperText status={cleared ? "warning" : "info"}>
      {cleared
        ? `Your organization changed its expiration policy, so the date you chose is no longer allowed. The latest allowed is now ${date(latest)}.`
        : existing
          ? `Your organization's ${maxLifetimeDays}-day maximum counts from when this key was created or last rotated, so the latest allowed is ${date(latest)}.`
          : `Your organization requires an expiration date, and the latest allowed is ${date(latest)}.`}
    </HelperText>
  ) : null;

  // Two cells of the parent's grid: this column beside the name, and any
  // notice across the full width below them.
  return (
    <>
      <Flex direction="column" style={{ minWidth: 0 }}>
        {expired ? (
          <>
            <Text as="div" size="md" weight="semibold">
              Expires
            </Text>
            <Text color="text-mid">Expired</Text>
          </>
        ) : (
          <>
            <SelectField
              label="Expires"
              legacyLabelFormatting={false}
              size="md"
              maxMenuHeight={360}
              sort={false}
              isSearchable={false}
              placeholder="Choose an expiration"
              value={selection}
              onChange={(next) => {
                setSelection(next);
                if (next === NEVER) {
                  setValue(null);
                } else if (next !== DATE) {
                  setValue(addDays(new Date(), Number(next)));
                }
              }}
              options={[
                ...presets.map((days) => ({
                  label: presetLabel(days),
                  value: String(days),
                })),
                { label: "Expires on date", value: DATE },
                // Offered under a policy only as the edited key's unchanged state.
                ...(!required || (existing && !existing.expiresAt)
                  ? [{ label: "No expiration", value: NEVER }]
                  : []),
              ]}
              formatOptionLabel={({ label, value }, { context }) =>
                context === "value" && value === DATE ? "Expires on" : label
              }
            />
            {picksDate && (
              <Box mt="2">
                <DatePicker
                  id={dateId}
                  label="Date"
                  size="md"
                  date={value ?? undefined}
                  setDate={(d) => setValue(d ?? null)}
                  precision="date"
                  timeZone="local"
                  disableBefore={addDays(new Date(), 1)}
                  disableAfter={latest ?? undefined}
                  clampInput={false}
                  error={dateError}
                  required
                  containerClassName=""
                />
              </Box>
            )}
            {expiresNote}
          </>
        )}
      </Flex>
      {notice && <Box style={{ gridColumn: "1 / -1" }}>{notice}</Box>}
    </>
  );
};

export default ApiKeyExpirationField;
