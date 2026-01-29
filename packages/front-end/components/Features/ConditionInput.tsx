/* eslint-disable react-hooks/exhaustive-deps */

import React, { useState, useEffect } from "react";
import { some } from "lodash";
import { RxLoop } from "react-icons/rx";
import {
  PiArrowSquareOut,
  PiBracketsCurly,
  PiPlusBold,
  PiPlusCircleBold,
  PiXBold,
} from "react-icons/pi";
import { FaMagic } from "react-icons/fa";
import clsx from "clsx";
import format from "date-fns/format";
import { Box, Flex, Separator, Text, IconButton } from "@radix-ui/themes";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import Tooltip from "@/ui/Tooltip";
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
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import useSDKConnections from "@/hooks/useSDKConnections";

export function ConditionLabel({
  label,
  width = 35,
}: {
  label: string;
  width?: number;
}) {
  return (
    <Flex align="center" flexShrink="0" style={{ width }} mb="1">
      <Text weight="bold" size="2">
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

export function operatorSupportsCaseInsensitiveCheckbox(
  operator: string,
): boolean {
  return OPERATORS_WITH_CASE_INSENSITIVE.has(operator);
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
          <Callout status="warning" mt="2">
            Secure attribute hashing not guaranteed to work for complicated
            rules
          </Callout>
        )}
        <CaseInsensitiveRegexWarning value={value} project={props.project} />
      </>
    );

    return (
      <Box my="4">
        <Flex gap="2" mb="2">
          <Box flexGrow={"1"}>
            <label className={props.labelClassName || ""}>{title}</label>
          </Box>
          {simpleAllowed && attributes.size > 0 && (
            <Box>
              <Link
                onClick={() => {
                  const newConds = jsonToConds(value, attributes);
                  // TODO: show error
                  if (newConds === null) return;
                  setConds(newConds);
                  setAdvanced(false);
                }}
              >
                <RxLoop /> Simple mode
              </Link>
            </Box>
          )}
        </Flex>
        <Box className="appbox bg-light px-3 py-3">
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
        <label className={props.labelClassName || ""}>{title}</label>
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
    <Box my="4">
      <Flex gap="2" mb="2">
        <Box flexGrow={"1"}>
          <label
            className={props.labelClassName || ""}
            style={{ marginBottom: 0 }}
          >
            {title}
          </label>
        </Box>
        <Box>
          <Link onClick={() => setAdvanced(true)}>
            <RxLoop /> Advanced mode
          </Link>
        </Box>
      </Flex>

      {conds.map((andGroup, i) => (
        <Box key={i}>
          {i > 0 && (
            <Box mb="2">
              <Text weight="bold">OR</Text>
            </Box>
          )}
          <ConditionAndGroupInput
            conds={andGroup}
            setConds={(newConds) => {
              const newAndGroups = [...conds];

              // Empty array means delete the AND group
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
        </Box>
      ))}

      <Flex align="center" mt="2">
        {attributeSchema.length > 0 && (
          <Link
            className="or-button"
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
          >
            <Text weight="bold">
              <PiPlusBold className="mr-1" />
              OR
            </Text>
          </Link>
        )}
      </Flex>

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
    <Box>
      <Box className="appbox bg-light px-3 py-3">
        {conds.map(({ field, operator, value }, i) => {
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
              formatOptionLabel={(o) => (
                <span title={o.tooltip}>{o.label}</span>
              )}
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

            return (
              <React.Fragment key={i}>
                {i > 0 && (
                  <Separator
                    size="4"
                    mt="6"
                    mb="4"
                    className="gb-separator-heavy"
                  />
                )}
                <Flex direction="column" gap="1" mb="4">
                  <ConditionLabel label={i === 0 ? "IF" : "AND"} />
                  <Flex gap="2" align="start">
                    <Flex
                      gap="2"
                      align="start"
                      wrap="wrap"
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      <Box style={{ flex: "1 1 0", minWidth: 200 }}>
                        {fieldSelector}
                      </Box>
                      <Box style={{ flex: "1 1 0", minWidth: 200 }}>
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
                      </Box>
                      <Box style={{ flexBasis: "100%", minWidth: 0 }}>
                        <MultiSelectField
                          value={ids}
                          options={groupOptions}
                          onChange={handleListChange}
                          name="value"
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
                          required
                        />
                      </Box>
                    </Flex>
                    <Box px="1" pt="3" style={{ width: 16, flexShrink: 0 }}>
                      {(conds.length > 1 ||
                        (conds.length === 1 && orGroupsCount > 1) ||
                        !props.require) && (
                        <Tooltip content="Remove condition">
                          <IconButton
                            type="button"
                            color="red"
                            variant="ghost"
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
                      )}
                    </Box>
                  </Flex>
                </Flex>
              </React.Fragment>
            );
          }

          if (!attribute) {
            console.error("Attribute not found in attribute Map.");
            return;
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
                          value:
                            attribute.format === "version" ? "$veq" : "$eq",
                        },
                        {
                          label: "is not equal to",
                          value:
                            attribute.format === "version" ? "$vne" : "$ne",
                        },
                        { label: "matches regex", value: "$regex" },
                        { label: "does not match regex", value: "$notRegex" },
                        {
                          label:
                            attribute.format === "date"
                              ? "is after"
                              : "is greater than",
                          value:
                            attribute.format === "version" ? "$vgt" : "$gt",
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
                          value:
                            attribute.format === "version" ? "$vlt" : "$lt",
                        },
                        {
                          label:
                            attribute.format === "date"
                              ? "is before or on"
                              : "is less than or equal to",
                          value:
                            attribute.format === "version" ? "$vlte" : "$lte",
                        },
                        { label: "is any of", value: "$in" },
                        { label: "is none of", value: "$nin" },
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
                !["$eq", "$ne", "$in", "$nin", "$ini", "$nini"].includes(
                  o.value,
                ),
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

          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <Separator
                  size="4"
                  mt="6"
                  mb="4"
                  className="gb-separator-heavy"
                />
              )}
              <Flex direction="column" gap="1" mb="3">
                <ConditionLabel label={i === 0 ? "IF" : "AND"} />
                <Flex gap="2" align="start">
                  <Flex
                    gap="2"
                    align="start"
                    wrap="wrap"
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <Box style={{ flex: "1 1 0", minWidth: 200 }}>
                      {fieldSelector}
                    </Box>
                    <Box style={{ flex: "1 1 0", minWidth: 200 }}>
                      <Flex direction="column" gap="1">
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
                        {operatorSupportsCaseInsensitiveCheckbox(operator) && (
                          <Checkbox
                            value={isCaseInsensitiveOperator(operator)}
                            setValue={(checked) => {
                              const newOperator = withOperatorCaseInsensitivity(
                                getDisplayOperator(operator),
                                checked,
                              );
                              handleCondsChange(newOperator, "operator");
                            }}
                            label="Case insensitive"
                            size="sm"
                            weight="regular"
                          />
                        )}
                      </Flex>
                    </Box>
                    {displayType === "select-only" ? null : [
                        "$inGroup",
                        "$notInGroup",
                      ].includes(operator) && savedGroupOptions.length > 0 ? (
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
                          placeholder="Enter some values..."
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
                  </Flex>
                  <Box px="1" pt="3" style={{ width: 16, flexShrink: 0 }}>
                    {(conds.length > 1 ||
                      (conds.length === 1 && orGroupsCount > 1) ||
                      !props.require) && (
                      <Tooltip content="Remove condition">
                        <IconButton
                          type="button"
                          color="red"
                          variant="ghost"
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
                    )}
                  </Box>
                </Flex>
              </Flex>
            </React.Fragment>
          );
        })}
        <Flex align="center" mt="3">
          {attributeSchema.length > 0 && (
            <Link
              onClick={() => {
                const prop = attributeSchema[0];
                setConds([
                  ...conds,
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
                ]);
              }}
            >
              <Text weight="bold">
                <PiPlusBold className="mr-1" />
                AND
              </Text>
            </Link>
          )}
        </Flex>
      </Box>
    </Box>
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
