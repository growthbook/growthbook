import React from "react";
import { date } from "shared/dates";
import { COMBO_DIMENSION_LENGTH } from "shared/experiments";
import { Flex } from "@radix-ui/themes";
import DatePicker from "@/components/DatePicker";
import SelectField, { SingleValue } from "@/components/Forms/SelectField";
import HelperText from "@/ui/HelperText";

export type SpecialDimensionKind = "cutoff" | "combo";

export type SpecialDimensionDraft = {
  kind: SpecialDimensionKind;
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

export function isSpecialDimensionDraftValid(
  draft: SpecialDimensionDraft,
  cutoffMin?: Date,
  cutoffMax?: Date,
): boolean {
  if (draft.kind === "cutoff") {
    return (
      !!draft.cutoff && isCutoffWithinBounds(draft.cutoff, cutoffMin, cutoffMax)
    );
  }
  const ids = draft.constituentIds.filter(Boolean);
  return (
    ids.length === COMBO_DIMENSION_LENGTH &&
    new Set(ids).size === COMBO_DIMENSION_LENGTH
  );
}

export default function SpecialDimensionFields({
  draft,
  setDraft,
  constituentOptions,
  cutoffMin,
  cutoffMax,
}: {
  draft: SpecialDimensionDraft;
  setDraft: (draft: SpecialDimensionDraft) => void;
  constituentOptions: SingleValue[];
  cutoffMin?: Date;
  cutoffMax?: Date;
}) {
  if (draft.kind === "cutoff") {
    const outOfBounds =
      !!draft.cutoff &&
      !isCutoffWithinBounds(draft.cutoff, cutoffMin, cutoffMax);
    return (
      <div>
        <DatePicker
          label="First exposure cutoff (UTC)"
          date={draft.cutoff}
          setDate={(d) => setDraft({ ...draft, cutoff: d })}
          precision="datetime"
          disableBefore={cutoffMin}
          disableAfter={cutoffMax}
          helpText="Split units by whether they were first exposed before or after this datetime"
        />
        {outOfBounds && (
          <HelperText status="error">
            {`Cutoff must be within the experiment window (${
              cutoffMin ? date(cutoffMin) : "start"
            } – ${cutoffMax ? date(cutoffMax) : "now"}).`}
          </HelperText>
        )}
      </div>
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
    <Flex direction="column" gap="1">
      <SelectField
        label="First dimension"
        value={firstId}
        onChange={(v) => setConstituent(0, v)}
        options={constituentOptions.filter((o) => o.value !== secondId)}
        initialOption="Choose dimension..."
        sort={false}
      />
      <SelectField
        label="Second dimension"
        value={secondId}
        onChange={(v) => setConstituent(1, v)}
        options={constituentOptions.filter((o) => o.value !== firstId)}
        initialOption="Choose dimension..."
        sort={false}
      />
      {duplicate && (
        <HelperText status="error">Choose two different dimensions.</HelperText>
      )}
    </Flex>
  );
}
