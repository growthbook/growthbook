/* eslint-disable react-hooks/exhaustive-deps */

import React, { useState, useEffect } from "react";
import { some } from "lodash";
import {
  PiArrowSquareOut,
  PiBracketsCurly,
  PiPlusCircleBold,
  PiXBold,
  PiTextAa,
} from "react-icons/pi";
import { FaMagic } from "react-icons/fa";
import clsx from "clsx";
import format from "date-fns/format";
import { Box, Flex, Text, IconButton, Separator } from "@radix-ui/themes";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import Tooltip from "@/ui/Tooltip";
import Switch from "@/ui/Switch";
import {
  Condition,
  condToJson,
  jsonToConds,
  useAttributeMap,
  useAttributeSchema,
  getDefaultOperator,
  getFormatEquivalentOperator,
  formatJSON,
  LARGE_FILE_SIZE,
} from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import StringArrayField from "@/components/Forms/StringArrayField";
import CountrySelector, {
  ALL_COUNTRY_CODES,
} from "@/components/Forms/CountrySelector";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import DatePicker from "@/components/DatePicker";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import useSDKConnections from "@/hooks/useSDKConnections";
import {
  ConditionGroupCard,
  ConditionRow,
  OrSeparator,
  AddConditionButton,
  AddOrGroupButton,
  ConditionRowLabel,
} from "./ConditionGroup";

export function ConditionLabel({
  label,
  width = 35,
}: {
  label: string;
  width?: number;
}) {
  return (
    <Flex align="center" flexShrink="0" style={{ width }} mb="1">
      <Text weight="medium" size="2">
        {label}
      </Text>
    </Flex>
  );
}

/** Operators that support a case-insensitive variant via checkbox (list + regex) */
const OPERATORS_WITH_CASE_INSENSITIVE = new Set([
  "$in",
  "$nin",
  "$ini",
  "$nini",
  "$regex",
  "$notRegex",
  "$regexi",
  "$notRegexi",
]);

/** Base operator -> case-insensitive variant */
const CASE_INSENSITIVE_VARIANT: Record<string, string> = {
  $in: "$ini",
  $nin: "$nini",
  $regex: "$regexi",
  $notRegex: "$notRegexi",
};

/** Case-insensitive variant -> base operator */
const BASE_OPERATOR: Record<string, string> = {
  $ini: "$in",
  $nini: "$nin",
  $regexi: "$regex",
  $notRegexi: "$notRegex",
};

export function operatorSupportsCaseInsensitive(operator: string): boolean {
  return OPERATORS_WITH_CASE_INSENSITIVE.has(operator);
}

/** True when the attribute datatype supports case-insensitive operators (false for secureString / secureString[]). */
export function datatypeSupportsCaseInsensitive(datatype?: string): boolean {
  return !["secureString", "secureString[]"].includes(datatype ?? "");
}

export function getDisplayOperator(operator: string): string {
  return BASE_OPERATOR[operator] ?? operator;
}

export function isCaseInsensitiveOperator(operator: string): boolean {
  return operator in BASE_OPERATOR;
}

export function withOperatorCaseInsensitivity(
  baseOperator: string,
  caseInsensitive: boolean,
): string {
  if (caseInsensitive && baseOperator in CASE_INSENSITIVE_VARIANT) {
    return CASE_INSENSITIVE_VARIANT[baseOperator];
  }
  return baseOperator;
}

interface Props {
  defaultValue: string;
  onChange: (value: string) => void;
  project: string;
  labelClassName?: string;
  emptyText?: string;
  title?: string;
  require?: boolean;
  allowNestedSavedGroups?: boolean;
  excludeSavedGroupId?: string;
}

export default function ConditionInput(props: Props) {
  const attributes = useAttributeMap(props.project);

  const title = props.title || "Target by Attributes";
  const emptyText = props.emptyText || "Applied to everyone by default.";

  const [advanced, setAdvanced] = useState(
    () => jsonToConds(props.defaultValue, attributes) === null,
  );
  const [simpleAllowed, setSimpleAllowed] = useState(false);
  const [value, setValue] = useState(props.defaultValue);
  const [conds, setConds] = useState(
    () => jsonToConds(props.defaultValue, attributes) || [],
  );
  const defaultCodeEditorToggledOn = value.length <= LARGE_FILE_SIZE;
  const [codeEditorToggledOn, setCodeEditorToggledOn] = useState(
    defaultCodeEditorToggledOn,
  );

  const attributeSchema = useAttributeSchema(false, props.project);

  useEffect(() => {
    if (advanced) return;
    setValue(condToJson(conds, attributes));
  }, [advanced, conds]);

  useEffect(() => {
    props.onChange(value);
    setSimpleAllowed(jsonToConds(value, attributes) !== null);
  }, [value, attributes]);

  const usingDisabledEqualityAttributes = conds.some((cond) =>
    cond.some((c) => !!attributes.get(c.field)?.disableEqualityConditions),
  );

  if (advanced || !attributes.size || !simpleAllowed) {
    const hasSecureAttributes = some(
      [...attributes].filter(([_, a]) =>
        ["secureString", "secureString[]"].includes(a.datatype),
      ),
    );

    const formatted = formatJSON(value);

    const codeEditorToggleButton = (
      <Link
        onClick={(e) => {
          e.preventDefault();
          setCodeEditorToggledOn(!codeEditorToggledOn);
        }}
        style={{ whiteSpace: "nowrap" }}
      >
        <PiBracketsCurly />{" "}
        {codeEditorToggledOn ? "Use text editor" : "Use code editor"}
      </Link>
    );

    const formatJSONButton = (
      <Link
        onClick={(e) => {
          e.preventDefault();
          if (formatted && formatted !== value) {
            setValue(formatted);
          }
        }}
        style={{
          whiteSpace: "nowrap",
          opacity: !formatted || formatted === value ? 0.5 : 1,
          cursor: !formatted || formatted === value ? "default" : "pointer",
        }}
      >
        <FaMagic /> Format JSON
      </Link>
    );

    const combinedHelpText = (
      <>
        <Flex justify="between" align="center">
          <div>JSON format using MongoDB query syntax.</div>
          <Flex gap="3">
            {codeEditorToggleButton}
            {formatJSONButton}
          </Flex>
        </Flex>
        {hasSecureAttributes && (
          <HelperText status="warning" mt="2">
            Secure attribute hashing not guaranteed to work for complicated
            rules
          </HelperText>
        )}
        <CaseInsensitiveRegexWarning value={value} project={props.project} />
      </>
    );

    return (
      <Box mb="6">
        <Flex gap="2" mb="1">
          <Box flexGrow="1">
            <label className={props.labelClassName}>{title}</label>
          </Box>
          {simpleAllowed && attributes.size > 0 && (
            <Switch
              value={advanced}
              onChange={(checked) => {
                if (checked) {
                  setAdvanced(true);
                } else {
                  const newConds = jsonToConds(value, attributes);
                  if (newConds === null) return;
                  setConds(newConds);
                  setAdvanced(false);
                }
              }}
              label="Advanced"
              size="1"
            />
          )}
        </Flex>
        <Box mb="3">
          {codeEditorToggledOn ? (
            <CodeTextArea
              labelClassName={props.labelClassName}
              language="json"
              value={value}
              setValue={setValue}
              helpText={combinedHelpText}
              resizable={true}
              showCopyButton={true}
              showFullscreenButton={true}
            />
          ) : (
            <Field
              labelClassName={props.labelClassName}
              containerClassName="mb-0"
              placeholder=""
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
              }}
              textarea
              minRows={1}
              helpText={combinedHelpText}
            />
          )}
        </Box>
      </Box>
    );
  }

  if (!conds.length || (conds.length === 1 && !conds[0].length)) {
    return (
      <Box my="4">
        <label className={props.labelClassName}>{title}</label>
        <Box>
          <Text color="gray" style={{ fontStyle: "italic" }} mb="2">
            {emptyText}
          </Text>
          <Box mt="2">
            <Link
              onClick={() => {
                const prop = attributeSchema[0];
                setConds([
                  [
                    {
                      field: prop?.property || "",
                      operator:
                        prop?.datatype === "boolean"
                          ? "$true"
                          : prop?.disableEqualityConditions
                            ? "$regex"
                            : "$eq",
                      value: "",
                    },
                  ],
                ]);
              }}
            >
              <Text weight="bold">
                <PiPlusCircleBold className="mr-1" />
                Add attribute targeting
              </Text>
            </Link>
          </Box>
        </Box>
      </Box>
    );
  }
  return (
    <Box mb="6">
      <Flex justify="between" align="center" mb="1">
        <label className={props.labelClassName}>{title}</label>
        {attributes.size > 0 && (
          <Switch
            value={advanced}
            onChange={(checked) => {
              if (checked) {
                setAdvanced(true);
              } else {
                const newConds = jsonToConds(value, attributes);
                if (newConds === null) return;
                setConds(newConds);
                setAdvanced(false);
              }
            }}
            label="Advanced"
            size="1"
          />
        )}
      </Flex>

      {conds.map((andGroup, i) => (
        <Box key={i}>
          {i > 0 && <OrSeparator />}
          <ConditionGroupCard
            targetingType="attribute"
            total={conds.length}
            extendToCardEdges
            addButton={
              attributeSchema.length > 0 ? (
                <AddConditionButton
                  onClick={() => {
                    const prop = attributeSchema[0];
                    const newAndGroups = [...conds];
                    newAndGroups[i] = [
                      ...andGroup,
                      {
                        field: prop?.property || "",
                        operator:
                          prop?.datatype === "boolean"
                            ? "$true"
                            : prop?.disableEqualityConditions
                              ? "$regex"
                              : "$eq",
                        value: "",
                      },
                    ];
                    setConds(newAndGroups);
                  }}
                />
              ) : undefined
            }
          >
            <ConditionAndGroupInput
              conds={andGroup}
              setConds={(newConds) => {
                const newAndGroups = [...conds];
                if (newConds.length === 0) {
                  newAndGroups.splice(i, 1);
                } else {
                  newAndGroups[i] = newConds;
                }
                setConds(newAndGroups);
              }}
              orGroupsCount={conds.length}
              project={props.project}
              labelClassName={props.labelClassName}
              emptyText={props.emptyText}
              title={props.title}
              require={props.require}
              allowNestedSavedGroups={props.allowNestedSavedGroups}
              excludeSavedGroupId={props.excludeSavedGroupId}
            />
          </ConditionGroupCard>
        </Box>
      ))}

      {attributeSchema.length > 0 && (
        <AddOrGroupButton
          onClick={() => {
            const prop = attributeSchema[0];
            setConds([
              ...conds,
              [
                {
                  field: prop?.property || "",
                  operator:
                    prop?.datatype === "boolean"
                      ? "$true"
                      : prop?.disableEqualityConditions
                        ? "$regex"
                        : "$eq",
                  value: "",
                },
              ],
            ]);
          }}
        />
      )}

      {usingDisabledEqualityAttributes && (
        <Callout status="warning" mt="4">
          Be careful not to include Personally Identifiable Information (PII) in
          your targeting conditions.
        </Callout>
      )}

      <CaseInsensitiveRegexWarning value={value} project={props.project} />
    </Box>
  );
}

function ConditionAndGroupInput({
  conds,
  setConds,
  orGroupsCount,
  ...props
}: {
  conds: Condition[];
  setConds: (conds: Condition[]) => void;
  orGroupsCount: number;
  project: string;
  labelClassName?: string;
  emptyText?: string;
  title?: string;
  require?: boolean;
  allowNestedSavedGroups?: boolean;
  excludeSavedGroupId?: string;
}) {
  const { savedGroups, getSavedGroupById } = useDefinitions();

  const attributes = useAttributeMap(props.project);

  // Normalize: secureString/secureString[] only support exact operators (in/nin), not case-insensitive (ini/nini)
  useEffect(() => {
    let changed = false;
    const next = conds.map((c) => {
      const attr = attributes.get(c.field);
      if (
        attr &&
        ["secureString", "secureString[]"].includes(attr.datatype) &&
        isCaseInsensitiveOperator(c.operator)
      ) {
        changed = true;
        return { ...c, operator: getDisplayOperator(c.operator) };
      }
      return c;
    });
    if (changed) setConds(next);
  }, [conds, attributes, setConds]);

  const savedGroupOperators = [
    {
      label: "is in the saved group",
      value: "$inGroup",
    },
    {
      label: "is not in the saved group",
      value: "$notInGroup",
    },
  ];

  const listOperators = ["$in", "$nin", "$ini", "$nini"];

  const attributeSchema = useAttributeSchema(false, props.project);

  return (
    <>
      {conds.flatMap(({ field, operator, value }, i) => {
        const attribute = attributes.get(field);

        const handleCondsChange = (value: string, name: string) => {
          const newConds = [...conds];
          newConds[i] = { ...newConds[i] };
          newConds[i][name] = value;
          setConds(newConds);
        };

        const handleFieldChange = (
          e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>,
        ) => {
          const name = e.target.name;
          const value: string | number = e.target.value;

          handleCondsChange(value, name);
        };

        const handleListChange = (values: string[]) => {
          const name = "value";
          const value: string | number = values.join(",");
          handleCondsChange(value, name);
        };

        const fieldSelector = (
          <SelectField
            useMultilineLabels={true}
            value={field}
            options={[
              ...attributeSchema.map((s) => ({
                label: s.property,
                value: s.property,
                tooltip: s.description || "",
              })),
              ...(props.allowNestedSavedGroups || field === "$savedGroups"
                ? [
                    {
                      label: "Saved Group",
                      value: "$savedGroups",
                    },
                  ]
                : []),
            ]}
            formatOptionLabel={(o) => <span title={o.tooltip}>{o.label}</span>}
            name="field"
            onChange={(value) => {
              const newConds = [...conds];
              newConds[i] = { ...newConds[i] };
              newConds[i]["field"] = value;

              if (value === "$savedGroups") {
                newConds[i]["operator"] = "$in";
                newConds[i]["value"] = "";
                setConds(newConds);
                return;
              }

              const newAttribute = attributes.get(value);
              const hasAttrChanged =
                newAttribute?.datatype !== attribute?.datatype ||
                newAttribute?.array !== attribute?.array ||
                !!newAttribute?.disableEqualityConditions !==
                  !!attribute?.disableEqualityConditions;

              if (hasAttrChanged && newAttribute) {
                newConds[i]["operator"] = getDefaultOperator(newAttribute);
                newConds[i]["value"] = newConds[i]["value"] || "";
              } else if (
                newAttribute &&
                newAttribute.format !== attribute?.format
              ) {
                const desiredOperator = getFormatEquivalentOperator(
                  conds[i].operator,
                  newAttribute?.format,
                );
                if (desiredOperator) {
                  newConds[i]["operator"] = desiredOperator;
                } else {
                  newConds[i]["operator"] = getDefaultOperator(newAttribute);
                  newConds[i]["value"] = newConds[i]["value"] || "";
                }
              }
              setConds(newConds);
            }}
            sort={false}
          />
        );

        if (field === "$savedGroups") {
          const groupOptions = savedGroups
            .filter((g) => g.id !== props.excludeSavedGroupId)
            .map((g) => ({
              label: g.groupName,
              value: g.id,
            }));

          // Add any missing ids to options
          const ids = value
            ? value
                .split(",")
                .map((val) => val.trim())
                .filter((v) => !!v)
            : [];

          ids.forEach((id) => {
            if (!groupOptions.find((option) => option.value === id)) {
              groupOptions.push({ label: id, value: id });
            }
          });

        return [
          <ConditionRow
            key={i}
            prefixSlot={
              i > 0 ? <ConditionRowLabel label="AND" /> : null
            }
            attributeSlot={fieldSelector}
              operatorSlot={
                <SelectField
                  useMultilineLabels={true}
                  value={operator}
                  name="operator"
                  options={[
                    { label: "in", value: "$in" },
                    { label: "not in", value: "$nin" },
                  ]}
                  sort={false}
                  onChange={(v) => {
                    handleCondsChange(v, "operator");
                  }}
                />
              }
              valueSlot={
                <MultiSelectField
                  value={ids}
                  options={groupOptions}
                  onChange={handleListChange}
                  name="value"
                  formatOptionLabel={(o, meta) => {
                    if (meta.context !== "value" || !o.value) return o.label;
                    const group = getSavedGroupById(o.value);
                    if (!group) return o.label;
                    return (
                      <Link
                        href={`/saved-groups/${group.id}`}
                        target="_blank"
                        style={{ position: "relative", zIndex: 1000 }}
                      >
                        {o.label} <PiArrowSquareOut />
                      </Link>
                    );
                  }}
                  required
                />
              }
              removeSlot={
                (conds.length > 1 ||
                  (conds.length === 1 && orGroupsCount > 1) ||
                  !props.require) && (
                  <Tooltip content="Remove condition">
                    <IconButton
                      type="button"
                      color="gray"
                      variant="ghost"
                      radius="full"
                      size="1"
                      onClick={() => {
                        if (conds.length === 1) {
                          setConds([]);
                        } else {
                          const newConds = [...conds];
                          newConds.splice(i, 1);
                          setConds(newConds);
                        }
                      }}
                    >
                      <PiXBold size={16} />
                    </IconButton>
                  </Tooltip>
                )
              }
            />,
          ];
        }

        if (!attribute) {
          console.error("Attribute not found in attribute Map.");
          return [];
        }

        const savedGroupOptions = savedGroups
          // First, limit to groups with the correct attribute
          .filter((g) => g.type === "list" && g.attributeKey === field)
          // Filter by project
          .filter((group) => {
            return (
              !props.project ||
              !group.projects?.length ||
              group.projects.includes(props.project)
            );
          })
          // Then, transform into the select option format
          .map((g) => ({ label: g.groupName, value: g.id }));

        let operatorOptions =
          attribute.datatype === "boolean"
            ? [
                { label: "is true", value: "$true" },
                { label: "is false", value: "$false" },
                { label: "is not NULL", value: "$exists" },
                { label: "is NULL", value: "$notExists" },
              ]
            : attribute.array
              ? [
                  { label: "includes", value: "$includes" },
                  { label: "does not include", value: "$notIncludes" },
                  { label: "is empty", value: "$empty" },
                  { label: "is not empty", value: "$notEmpty" },
                  { label: "is not NULL", value: "$exists" },
                  { label: "is NULL", value: "$notExists" },
                ]
              : attribute.enum?.length || 0 > 0
                ? [
                    { label: "is equal to", value: "$eq" },
                    { label: "is not equal to", value: "$ne" },
                    { label: "is any of", value: "$in" },
                    { label: "is none of", value: "$nin" },
                    { label: "is not NULL", value: "$exists" },
                    { label: "is NULL", value: "$notExists" },
                  ]
                : attribute.datatype === "string"
                  ? [
                      {
                        label: "is equal to",
                        value: attribute.format === "version" ? "$veq" : "$eq",
                      },
                      {
                        label: "is not equal to",
                        value: attribute.format === "version" ? "$vne" : "$ne",
                      },
                      { label: "is any of", value: "$in" },
                      { label: "is none of", value: "$nin" },
                      { label: "matches regex", value: "$regex" },
                      { label: "does not match regex", value: "$notRegex" },
                      {
                        label:
                          attribute.format === "date"
                            ? "is after"
                            : "is greater than",
                        value: attribute.format === "version" ? "$vgt" : "$gt",
                      },
                      {
                        label:
                          attribute.format === "date"
                            ? "is after or on"
                            : "is greater than or equal to",
                        value:
                          attribute.format === "version" ? "$vgte" : "$gte",
                      },
                      {
                        label:
                          attribute.format === "date"
                            ? "is before"
                            : "is less than",
                        value: attribute.format === "version" ? "$vlt" : "$lt",
                      },
                      {
                        label:
                          attribute.format === "date"
                            ? "is before or on"
                            : "is less than or equal to",
                        value:
                          attribute.format === "version" ? "$vlte" : "$lte",
                      },
                      { label: "is not NULL", value: "$exists" },
                      { label: "is NULL", value: "$notExists" },
                      ...(savedGroupOptions.length > 0
                        ? savedGroupOperators
                        : []),
                    ]
                  : attribute.datatype === "secureString"
                    ? [
                        { label: "is equal to", value: "$eq" },
                        { label: "is not equal to", value: "$ne" },
                        { label: "is any of", value: "$in" },
                        { label: "is none of", value: "$nin" },
                        { label: "is not NULL", value: "$exists" },
                        { label: "is NULL", value: "$notExists" },
                        ...(savedGroupOptions.length > 0
                          ? savedGroupOperators
                          : []),
                      ]
                    : attribute.datatype === "number"
                      ? [
                          { label: "is equal to", value: "$eq" },
                          { label: "is not equal to", value: "$ne" },
                          { label: "is greater than", value: "$gt" },
                          {
                            label: "is greater than or equal to",
                            value: "$gte",
                          },
                          { label: "is less than", value: "$lt" },
                          {
                            label: "is less than or equal to",
                            value: "$lte",
                          },
                          { label: "is any of", value: "$in" },
                          { label: "is none of", value: "$nin" },
                          { label: "is not NULL", value: "$exists" },
                          { label: "is NULL", value: "$notExists" },
                          ...(savedGroupOptions.length > 0
                            ? savedGroupOperators
                            : []),
                        ]
                      : [];

        if (attribute.disableEqualityConditions) {
          // Remove equality operators if the attribute has them disabled
          operatorOptions = operatorOptions.filter(
            (o) =>
              !["$eq", "$ne", "$in", "$nin", "$ini", "$nini"].includes(o.value),
          );
        }

        let displayType:
          | "select-only"
          | "array-field"
          | "enum"
          | "number"
          | "string"
          | "isoCountryCode"
          | null = null;
        if (
          [
            "$exists",
            "$notExists",
            "$true",
            "$false",
            "$empty",
            "$notEmpty",
          ].includes(operator)
        ) {
          displayType = "select-only";
        } else if (attribute.enum === ALL_COUNTRY_CODES) {
          displayType = "isoCountryCode";
        } else if (attribute.enum.length) {
          displayType = "enum";
        } else if (listOperators.includes(operator)) {
          displayType = "array-field";
        } else if (attribute.datatype === "number") {
          displayType = "number";
        } else if (["string", "secureString"].includes(attribute.datatype)) {
          displayType = "string";
        }
        const hasExtraWhitespace =
          displayType === "string" && value !== value.trim();

        return [
          ...(i > 0 ? [<Separator key={`sep-${i}`} style={{ width: "100%", backgroundColor: "var(--slate-a3)" }} />] : []),
          <ConditionRow
            key={i}
            prefixSlot={
              i > 0 ? <ConditionRowLabel label="AND" /> : <Box style={{ width: 45 }} />
            }
            attributeSlot={fieldSelector}
            operatorSlot={
              <Flex gap="3" align="start">
                <Box flexGrow="1">
                  <SelectField
                    useMultilineLabels={true}
                    value={getDisplayOperator(operator)}
                    name="operator"
                    options={operatorOptions}
                    sort={false}
                    onChange={(v) => {
                      const newOperator = withOperatorCaseInsensitivity(
                        v,
                        isCaseInsensitiveOperator(operator),
                      );
                      handleCondsChange(newOperator, "operator");
                    }}
                  />
                </Box>
                {operatorSupportsCaseInsensitive(operator) &&
                  datatypeSupportsCaseInsensitive(attribute?.datatype) && (
                    <Tooltip
                      content={`Case insensitive: ${isCaseInsensitiveOperator(operator) ? "ON" : "OFF"}`}
                    >
                      <IconButton
                        type="button"
                        variant={isCaseInsensitiveOperator(operator) ? "soft" : "ghost"}
                        size="1"
                        radius="medium"
                        onClick={() => {
                          const newOperator = withOperatorCaseInsensitivity(
                            getDisplayOperator(operator),
                            !isCaseInsensitiveOperator(operator),
                          );
                          handleCondsChange(newOperator, "operator");
                        }}
                        style={{
                          width: 24,
                          height: 24,
                          margin: "8px 0 0 0",
                          padding: 0,
                        }}
                      >
                        <PiTextAa />
                      </IconButton>
                    </Tooltip>
                  )}
              </Flex>
            }
            valueSlot={
              displayType === "select-only" ? undefined : (
                <>
                  {["$inGroup", "$notInGroup"].includes(operator) &&
                  savedGroupOptions.length > 0 ? (
                    <Box style={{ flexBasis: "100%", minWidth: 0 }}>
                      <SelectField
                        useMultilineLabels={true}
                        options={savedGroupOptions.map((o) => ({
                          label: o.label,
                          value: o.value,
                        }))}
                        value={value}
                        onChange={(v) => {
                          handleCondsChange(v, "value");
                        }}
                        formatOptionLabel={(o, meta) => {
                          if (meta.context !== "value" || !o.value)
                            return o.label;
                          const group = getSavedGroupById(o.value);
                          if (!group) return o.label;
                          return (
                            <Link
                              href={`/saved-groups/${group.id}`}
                              target="_blank"
                              style={{ position: "relative", zIndex: 1000 }}
                            >
                              {o.label} <PiArrowSquareOut />
                            </Link>
                          );
                        }}
                        name="value"
                        initialOption="Choose group..."
                        required
                      />
                    </Box>
                  ) : displayType === "array-field" ? (
                    <Flex
                      direction="column"
                      align="start"
                      style={{ flexBasis: "100%", minWidth: 0 }}
                    >
                      <StringArrayField
                        containerClassName="w-100"
                        value={value ? value.trim().split(",") : []}
                        onChange={handleListChange}
                        placeholder="value 1, value 2, value 3..."
                        delimiters={["Enter", "Tab"]}
                        enableRawTextMode
                        required
                      />
                    </Flex>
                  ) : displayType === "isoCountryCode" ? (
                    <Box style={{ flexBasis: "100%", minWidth: 0 }}>
                      {listOperators.includes(operator) ? (
                        <CountrySelector
                          selectAmount="multi"
                          displayFlags={true}
                          value={
                            value
                              ? value.split(",").map((val) => val.trim())
                              : []
                          }
                          onChange={handleListChange}
                        />
                      ) : (
                        <CountrySelector
                          selectAmount="single"
                          displayFlags={true}
                          value={value}
                          onChange={(v) => {
                            handleCondsChange(v, "value");
                          }}
                        />
                      )}
                    </Box>
                  ) : displayType === "enum" ? (
                    <Box style={{ flexBasis: "100%", minWidth: 0 }}>
                      {listOperators.includes(operator) ? (
                        <MultiSelectField
                          options={attribute.enum.map((v) => ({
                            label: v,
                            value: v,
                          }))}
                          value={
                            value
                              ? value.split(",").map((val) => val.trim())
                              : []
                          }
                          onChange={handleListChange}
                          name="value"
                          required
                        />
                      ) : (
                        <SelectField
                          useMultilineLabels={true}
                          options={attribute.enum.map((v) => ({
                            label: v,
                            value: v,
                          }))}
                          value={value}
                          onChange={(v) => {
                            handleCondsChange(v, "value");
                          }}
                          name="value"
                          initialOption="Choose One..."
                          required
                        />
                      )}
                    </Box>
                  ) : displayType === "number" ? (
                    <Box style={{ flexBasis: "100%", minWidth: 0 }}>
                      <Field
                        type="number"
                        step="any"
                        value={value}
                        onChange={handleFieldChange}
                        name="value"
                        style={{ minHeight: 38 }}
                        required
                      />
                    </Box>
                  ) : displayType === "string" ? (
                    <Box style={{ flexBasis: "100%", minWidth: 0 }}>
                      {attribute.format === "date" &&
                      ![
                        "$regex",
                        "$notRegex",
                        "$regexi",
                        "$notRegexi",
                      ].includes(operator) ? (
                        <DatePicker
                          date={value}
                          setDate={(v) => {
                            handleCondsChange(
                              v ? format(v, "yyyy-MM-dd'T'HH:mm") : "",
                              "value",
                            );
                          }}
                          inputWidth={180}
                        />
                      ) : (
                        <Field
                          value={value}
                          onChange={handleFieldChange}
                          name="value"
                          style={{ minHeight: 38 }}
                          containerClassName={clsx({
                            error: hasExtraWhitespace,
                          })}
                          helpText={
                            hasExtraWhitespace ? (
                              <small className="text-danger">
                                Extra whitespace detected
                              </small>
                            ) : undefined
                          }
                          required
                        />
                      )}
                    </Box>
                  ) : null}
                </>
              )
            }
            removeSlot={
              (conds.length > 1 ||
                (conds.length === 1 && orGroupsCount > 1) ||
                !props.require) && (
                <Tooltip content="Remove condition">
                  <IconButton
                    type="button"
                    color="gray"
                    variant="ghost"
                    radius="full"
                    size="1"
                    onClick={() => {
                      if (conds.length === 1) {
                        setConds([]);
                      } else {
                        const newConds = [...conds];
                        newConds.splice(i, 1);
                        setConds(newConds);
                      }
                    }}
                  >
                    <PiXBold size={16} />
                  </IconButton>
                </Tooltip>
              )
            }
          />,
        ];
      })}
    </>
  );
}

export function CaseInsensitiveRegexWarning({
  value,
  project,
}: {
  value: string;
  project?: string;
}) {
  const { data: sdkConnectionsData } = useSDKConnections();
  // Check if conditions use case-insensitive operators
  // In valid JSON, operators are always quoted, so we only check for quoted versions
  const hasCaseInsensitiveOperator =
    value.includes('"$regexi"') ||
    value.includes('"$notRegexi"') ||
    value.includes('"$ini"') ||
    value.includes('"$nini"') ||
    value.includes('"$alli"');
  const hasSDKWithCaseInsensitive = getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
    project,
  }).includes("caseInsensitiveMembership");
  const hasSDKWithNoCaseInsensitive = !getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
    mustMatchAllConnections: true,
    project,
  }).includes("caseInsensitiveMembership");

  if (!hasCaseInsensitiveOperator || !hasSDKWithNoCaseInsensitive) {
    return null;
  }

  return (
    <Callout status={hasSDKWithCaseInsensitive ? "warning" : "error"} mt="2">
      {hasSDKWithCaseInsensitive
        ? "Some of your SDK Connections in this project may not support case-insensitive operators."
        : "None of your SDK Connections in this project support case-insensitive operators. Either upgrade your SDKs or use case-sensitive operators instead."}
      <Link
        href={"/sdks"}
        weight="bold"
        className="pl-2"
        rel="noreferrer"
        target="_blank"
      >
        View SDKs
        <PiArrowSquareOut className="ml-1" />
      </Link>
    </Callout>
  );
}
