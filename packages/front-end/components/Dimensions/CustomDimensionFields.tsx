import React from "react";
import { date } from "shared/dates";
import { COMBO_DIMENSION_LENGTH } from "shared/experiments";
import { Flex } from "@radix-ui/themes";
import DatePicker from "@/components/DatePicker";
import type { SingleValue } from "@/components/Forms/SelectField";
import HelperText from "@/ui/HelperText";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";

export type CustomDimensionKind = "cutoff" | "combo";

export type CustomDimensionDraft = {
  kind: CustomDimensionKind;
  cutoff?: Date;
  constituentIds: string[];
};

export function isCutoffWithinBounds(
  cutoff: Date,
  cutoffMin?: Date,
  cutoffMax?: Date,
): boolean {
  if (cutoffMin && cutoff <= cutoffMin) return false;
  if (cutoffMax && cutoff >= cutoffMax) return false;
  return true;
}

/** Short reason the draft can't be applied yet, or null when it is valid. */
export function customDimensionDraftError(
  draft: CustomDimensionDraft,
  cutoffMin?: Date,
  cutoffMax?: Date,
): string | null {
  if (draft.kind === "cutoff") {
    if (!draft.cutoff) return "Choose a cutoff time";
    if (!isCutoffWithinBounds(draft.cutoff, cutoffMin, cutoffMax)) {
      return "Choose a cutoff time within the experiment window";
    }
    return null;
  }
  const ids = draft.constituentIds.filter(Boolean);
  if (
    ids.length !== COMBO_DIMENSION_LENGTH ||
    new Set(ids).size !== COMBO_DIMENSION_LENGTH
  ) {
    return "Choose two different dimensions";
  }
  return null;
}

export function isCustomDimensionDraftValid(
  draft: CustomDimensionDraft,
  cutoffMin?: Date,
  cutoffMax?: Date,
): boolean {
  return customDimensionDraftError(draft, cutoffMin, cutoffMax) === null;
}

export default function CustomDimensionFields({
  draft,
  setDraft,
  constituentOptions,
  cutoffMin,
  cutoffMax,
}: {
  draft: CustomDimensionDraft;
  setDraft: (draft: CustomDimensionDraft) => void;
  constituentOptions: SingleValue[];
  cutoffMin?: Date;
  cutoffMax?: Date;
}) {
  if (draft.kind === "cutoff") {
    const outOfBounds =
      !!draft.cutoff &&
      !isCutoffWithinBounds(draft.cutoff, cutoffMin, cutoffMax);
    return (
      <Flex direction="column" gap="1">
        <DatePicker
          label="First exposure cutoff"
          timeZone="utc"
          date={draft.cutoff}
          setDate={(d) => setDraft({ ...draft, cutoff: d })}
          precision="datetime"
          disableBefore={cutoffMin}
          disableAfter={cutoffMax}
          helpText="Splits units by whether they were first exposed before or after this time"
        />
        {outOfBounds && (
          <HelperText status="error">
            {`Cutoff must be within the experiment window (${
              cutoffMin ? date(cutoffMin, "UTC") : "start"
            } - ${cutoffMax ? date(cutoffMax, "UTC") : "now"}).`}
          </HelperText>
        )}
      </Flex>
    );
  }

  const [firstId = "", secondId = ""] = draft.constituentIds;
  const setConstituent = (index: number, value: string) => {
    const constituentIds = [firstId, secondId];
    constituentIds[index] = value;
    setDraft({ ...draft, constituentIds });
  };
  const duplicate = !!firstId && firstId === secondId;

  return (
    // Reads like the `country & Plan Type` label we show once it's applied
    <Flex direction="column" mb="4">
      <Flex align="end" gap="2">
        <Select
          label="First dimension"
          value={firstId || undefined}
          setValue={(v) => setConstituent(0, v)}
          placeholder="Choose dimension..."
          style={{ flex: 1, minWidth: 0 }}
        >
          {constituentOptions
            .filter((o) => o.value !== secondId)
            .map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
        </Select>
        <Text color="text-mid" mb="1">
          &amp;
        </Text>
        <Select
          label="Second dimension"
          value={secondId || undefined}
          setValue={(v) => setConstituent(1, v)}
          placeholder="Choose dimension..."
          error={duplicate ? "Choose two different dimensions." : undefined}
          style={{ flex: 1, minWidth: 0 }}
        >
          {constituentOptions
            .filter((o) => o.value !== firstId)
            .map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
        </Select>
      </Flex>
    </Flex>
  );
}
