// Shared operator option definitions for condition/prerequisite targeting widgets.
// Each option has a full `label` (dropdown menu) and `shortLabel` (selected value display).
// shortLabel === label means no override yet for that operator.

export type OperatorOption = {
  label: string;
  shortLabel: string;
  value: string;
};

// Pass to react-select's formatOptionLabel to show shortLabel in the trigger, full label in the menu.
// When showing the selected value, indents slightly so short symbols don't crowd the left edge.
export function formatOperatorLabel(
  opt: OperatorOption,
  { context }: { context: "menu" | "value" },
): string {
  return context === "value" ? opt.shortLabel : opt.label;
}

// Shared single-operator definitions
const OP_EQ: OperatorOption = {
  label: "= is equal to",
  shortLabel: "=",
  value: "$eq",
};
const OP_NE: OperatorOption = {
  label: "≠ is not equal to",
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
  label: "> is greater than",
  shortLabel: ">",
  value: "$gt",
};
const OP_GTE: OperatorOption = {
  label: "≥ is greater than or equal to",
  shortLabel: "≥",
  value: "$gte",
};
const OP_LT: OperatorOption = {
  label: "< is less than",
  shortLabel: "<",
  value: "$lt",
};
const OP_LTE: OperatorOption = {
  label: "≤ is less than or equal to",
  shortLabel: "≤",
  value: "$lte",
};
const OP_REGEX: OperatorOption = {
  label: "~ matches regex",
  shortLabel: "regex",
  value: "$regex",
};
const OP_NOT_REGEX: OperatorOption = {
  label: "!~ does not match regex",
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

// Version operators
const OP_VEQ: OperatorOption = {
  label: "＝ is equal to",
  shortLabel: "＝",
  value: "$veq",
};
const OP_VNE: OperatorOption = {
  label: "≠ is not equal to",
  shortLabel: "≠",
  value: "$vne",
};
const OP_VGT: OperatorOption = {
  label: "> is greater than",
  shortLabel: ">",
  value: "$vgt",
};
const OP_VGTE: OperatorOption = {
  label: "≥ is greater than or equal to",
  shortLabel: "≥",
  value: "$vgte",
};
const OP_VLT: OperatorOption = {
  label: "< is less than",
  shortLabel: "<",
  value: "$vlt",
};
const OP_VLTE: OperatorOption = {
  label: "≤ is less than or equal to",
  shortLabel: "≤",
  value: "$vlte",
};

// Date operators (same $gt/$gte/$lt/$lte values, different labels)
const OP_AFTER: OperatorOption = {
  label: "is after",
  shortLabel: "is after",
  value: "$gt",
};
const OP_AFTER_ON: OperatorOption = {
  label: "is after or on",
  shortLabel: "is after or on",
  value: "$gte",
};
const OP_BEFORE: OperatorOption = {
  label: "is before",
  shortLabel: "is before",
  value: "$lt",
};
const OP_BEFORE_ON: OperatorOption = {
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
  } = {},
): OperatorOption[] {
  const { array, enumValues, format, savedGroupOptions = [] } = opts;
  const sg = savedGroupOptions.length > 0 ? SAVED_GROUP_OPERATORS : [];

  if (datatype === "boolean")
    return [OP_TRUE, OP_FALSE, OP_EXISTS, OP_NOT_EXISTS];
  if (array)
    return [
      OP_INCLUDES,
      OP_NOT_INCLUDES,
      OP_EMPTY,
      OP_NOT_EMPTY,
      OP_EXISTS,
      OP_NOT_EXISTS,
    ];
  if (enumValues?.length)
    return [OP_EQ, OP_NE, OP_IN, OP_NIN, OP_EXISTS, OP_NOT_EXISTS, ...sg];
  if (datatype === "string") {
    if (format === "date")
      return [
        OP_EQ,
        OP_NE,
        OP_IN,
        OP_NIN,
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
