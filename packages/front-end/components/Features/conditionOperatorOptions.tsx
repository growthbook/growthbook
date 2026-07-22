// Shared operator option definitions for condition/prerequisite targeting widgets.
// Each option has a full `label` (dropdown menu), an optional `icon` (symbol prefix),
// and a `shortLabel` (selected value display).
// shortLabel === label means no override yet for that operator.

import React from "react";

export type OperatorOption = {
  label: string;
  shortLabel: string;
  icon?: string;
  value: string;
};

const ICON_WIDTH = 20;

// Pass to react-select's formatOptionLabel.
// In menu context: fixed-width icon box + label text (placeholder box if no icon).
// In value context: shortLabel string.
export function formatOperatorLabel(
  opt: OperatorOption,
  { context }: { context: "menu" | "value" },
): React.ReactNode {
  if (context === "menu") {
    return (
      <span style={{ display: "flex", alignItems: "center" }}>
        <span
          style={{
            width: ICON_WIDTH,
            flexShrink: 0,
            textAlign: "center",
            fontFamily: "monospace",
            marginRight: 6,
          }}
        >
          {opt.icon ?? ""}
        </span>
        {opt.label}
      </span>
    );
  }
  return opt.shortLabel;
}

// Shared single-operator definitions
const OP_EQ: OperatorOption = {
  icon: "=",
  label: "is equal to",
  shortLabel: "=",
  value: "$eq",
};
const OP_NE: OperatorOption = {
  icon: "≠",
  label: "is not equal to",
  shortLabel: "≠",
  value: "$ne",
};
const OP_IN: OperatorOption = {
  label: "is any of",
  shortLabel: "is any of",
  value: "$in",
};
const OP_NIN: OperatorOption = {
  label: "is none of",
  shortLabel: "is none of",
  value: "$nin",
};
const OP_GT: OperatorOption = {
  icon: ">",
  label: "is greater than",
  shortLabel: ">",
  value: "$gt",
};
const OP_GTE: OperatorOption = {
  icon: "≥",
  label: "is greater than or equal to",
  shortLabel: "≥",
  value: "$gte",
};
const OP_LT: OperatorOption = {
  icon: "<",
  label: "is less than",
  shortLabel: "<",
  value: "$lt",
};
const OP_LTE: OperatorOption = {
  icon: "≤",
  label: "is less than or equal to",
  shortLabel: "≤",
  value: "$lte",
};
const OP_REGEX: OperatorOption = {
  label: "matches regex",
  shortLabel: "regex",
  value: "$regex",
};
const OP_NOT_REGEX: OperatorOption = {
  label: "does not match regex",
  shortLabel: "not regex",
  value: "$notRegex",
};
const OP_EXISTS: OperatorOption = {
  label: "is not NULL",
  shortLabel: "is not NULL",
  value: "$exists",
};
const OP_NOT_EXISTS: OperatorOption = {
  label: "is NULL",
  shortLabel: "is NULL",
  value: "$notExists",
};
const OP_TRUE: OperatorOption = {
  label: "is true",
  shortLabel: "is true",
  value: "$true",
};
const OP_FALSE: OperatorOption = {
  label: "is false",
  shortLabel: "is false",
  value: "$false",
};
const OP_INCLUDES: OperatorOption = {
  label: "includes",
  shortLabel: "includes",
  value: "$includes",
};
const OP_NOT_INCLUDES: OperatorOption = {
  label: "does not include",
  shortLabel: "does not include",
  value: "$notIncludes",
};
const OP_EMPTY: OperatorOption = {
  label: "is empty",
  shortLabel: "is empty",
  value: "$empty",
};
const OP_NOT_EMPTY: OperatorOption = {
  label: "is not empty",
  shortLabel: "is not empty",
  value: "$notEmpty",
};
// Set operators for enum-constrained array attributes ($in/$nin worded for arrays)
const OP_INCLUDES_ANY: OperatorOption = {
  label: "includes any of",
  shortLabel: "includes any of",
  value: "$in",
};
const OP_INCLUDES_NONE: OperatorOption = {
  label: "includes none of",
  shortLabel: "includes none of",
  value: "$nin",
};

// Version operators
const OP_VEQ: OperatorOption = {
  icon: "=",
  label: "is equal to",
  shortLabel: "=",
  value: "$veq",
};
const OP_VNE: OperatorOption = {
  icon: "≠",
  label: "is not equal to",
  shortLabel: "≠",
  value: "$vne",
};
const OP_VGT: OperatorOption = {
  icon: ">",
  label: "is greater than",
  shortLabel: ">",
  value: "$vgt",
};
const OP_VGTE: OperatorOption = {
  icon: "≥",
  label: "is greater than or equal to",
  shortLabel: "≥",
  value: "$vgte",
};
const OP_VLT: OperatorOption = {
  icon: "<",
  label: "is less than",
  shortLabel: "<",
  value: "$vlt",
};
const OP_VLTE: OperatorOption = {
  icon: "≤",
  label: "is less than or equal to",
  shortLabel: "≤",
  value: "$vlte",
};

// Date operators (same $gt/$gte/$lt/$lte values, different labels)
const OP_AFTER: OperatorOption = {
  icon: ">",
  label: "is after",
  shortLabel: "is after",
  value: "$gt",
};
const OP_AFTER_ON: OperatorOption = {
  icon: "≥",
  label: "is after or on",
  shortLabel: "is after or on",
  value: "$gte",
};
const OP_BEFORE: OperatorOption = {
  icon: "<",
  label: "is before",
  shortLabel: "is before",
  value: "$lt",
};
const OP_BEFORE_ON: OperatorOption = {
  icon: "≤",
  label: "is before or on",
  shortLabel: "is before or on",
  value: "$lte",
};

// Saved group operators
const OP_IN_GROUP: OperatorOption = {
  label: "is in the saved group",
  shortLabel: "is in the saved group",
  value: "$inGroup",
};
const OP_NOT_IN_GROUP: OperatorOption = {
  label: "is not in the saved group",
  shortLabel: "is not in the saved group",
  value: "$notInGroup",
};

// Prerequisite "live" operators
const OP_LIVE: OperatorOption = {
  label: "is live",
  shortLabel: "is live",
  value: "$exists",
};
const OP_NOT_LIVE: OperatorOption = {
  label: "is not live",
  shortLabel: "is not live",
  value: "$notExists",
};

export const SAVED_GROUP_OPERATORS: OperatorOption[] = [
  OP_IN_GROUP,
  OP_NOT_IN_GROUP,
];

export function getConditionOperators(
  datatype: string,
  opts: {
    array?: boolean;
    enumValues?: string[];
    format?: string;
    savedGroupOptions?: unknown[];
    operator?: string;
  } = {},
): OperatorOption[] {
  const { array, enumValues, format, savedGroupOptions = [], operator } = opts;
  const sg = savedGroupOptions.length > 0 ? SAVED_GROUP_OPERATORS : [];

  if (datatype === "boolean")
    return [OP_TRUE, OP_FALSE, OP_EXISTS, OP_NOT_EXISTS];
  if (array) {
    if (enumValues?.length)
      // Enum-constrained list: set operators drive the restricted MultiSelect.
      // Single-value ops are only offered to keep an existing condition that
      // already uses them editable — hidden otherwise to avoid
      // duplicate-looking options.
      return [
        OP_INCLUDES_ANY,
        OP_INCLUDES_NONE,
        ...(operator === "$includes" || operator === "$notIncludes"
          ? [OP_INCLUDES, OP_NOT_INCLUDES]
          : []),
        OP_EMPTY,
        OP_NOT_EMPTY,
        OP_EXISTS,
        OP_NOT_EXISTS,
      ];
    return [
      OP_INCLUDES,
      OP_NOT_INCLUDES,
      OP_EMPTY,
      OP_NOT_EMPTY,
      OP_EXISTS,
      OP_NOT_EXISTS,
    ];
  }
  if (enumValues?.length)
    // Saved groups intentionally excluded for enum attributes (matches original behaviour)
    return [OP_EQ, OP_NE, OP_IN, OP_NIN, OP_EXISTS, OP_NOT_EXISTS];
  if (datatype === "string") {
    if (format === "date")
      // Regex operators are kept for date strings to avoid breaking existing conditions
      return [
        OP_EQ,
        OP_NE,
        OP_IN,
        OP_NIN,
        OP_REGEX,
        OP_NOT_REGEX,
        OP_AFTER,
        OP_AFTER_ON,
        OP_BEFORE,
        OP_BEFORE_ON,
        OP_EXISTS,
        OP_NOT_EXISTS,
        ...sg,
      ];
    if (format === "version")
      return [
        OP_VEQ,
        OP_VNE,
        OP_IN,
        OP_NIN,
        OP_REGEX,
        OP_NOT_REGEX,
        OP_VGT,
        OP_VGTE,
        OP_VLT,
        OP_VLTE,
        OP_EXISTS,
        OP_NOT_EXISTS,
        ...sg,
      ];
    return [
      OP_EQ,
      OP_NE,
      OP_IN,
      OP_NIN,
      OP_REGEX,
      OP_NOT_REGEX,
      OP_GT,
      OP_GTE,
      OP_LT,
      OP_LTE,
      OP_EXISTS,
      OP_NOT_EXISTS,
      ...sg,
    ];
  }
  if (datatype === "secureString")
    return [OP_EQ, OP_NE, OP_IN, OP_NIN, OP_EXISTS, OP_NOT_EXISTS, ...sg];
  if (datatype === "number")
    return [
      OP_EQ,
      OP_NE,
      OP_GT,
      OP_GTE,
      OP_LT,
      OP_LTE,
      OP_IN,
      OP_NIN,
      OP_EXISTS,
      OP_NOT_EXISTS,
      ...sg,
    ];
  return [];
}

// Prerequisite-specific operators (use "live"/"not live" instead of NULL)
export function getPrereqOperators(type?: string): OperatorOption[] {
  if (type === "boolean") return [OP_TRUE, OP_FALSE, OP_LIVE, OP_NOT_LIVE];
  if (type === "string")
    return [
      OP_LIVE,
      OP_NOT_LIVE,
      OP_EQ,
      OP_NE,
      OP_REGEX,
      OP_NOT_REGEX,
      OP_GT,
      OP_GTE,
      OP_LT,
      OP_LTE,
      OP_IN,
      OP_NIN,
    ];
  if (type === "number")
    return [
      OP_LIVE,
      OP_NOT_LIVE,
      OP_EQ,
      OP_NE,
      OP_GT,
      OP_GTE,
      OP_LT,
      OP_LTE,
      OP_IN,
      OP_NIN,
    ];
  return [OP_LIVE, OP_NOT_LIVE];
}
