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
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import Text from "@/ui/Text";
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
import SelectField, {
  FormatOptionLabelType,
} from "@/components/Forms/SelectField";
import CodeTextArea, {
  FIVE_LINES_HEIGHT,
} from "@/components/Forms/CodeTextArea";
import StringArrayField from "@/ui/StringArrayField";
import CountrySelector, {
  ALL_COUNTRY_CODES,
} from "@/components/Forms/CountrySelector";
import MultiSelectField from "@/ui/MultiSelectField";
import DatePicker from "@/components/DatePicker";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import RadioGroup from "@/ui/RadioGroup";
import SDKCapabilityWarning from "./SDKCapabilityWarning";
import {
  OperatorOption,
  formatOperatorLabel,
  getConditionOperators,
} from "./conditionOperatorOptions";
import {
  TargetingConditionsCard,
  ConditionRow,
  OrSeparator,
  AddConditionButton,
  AddOrGroupButton,
  ConditionRowLabel,
} from "./TargetingConditionsCard";
import {
  AttributeOptionWithTooltip,
  type AttributeOptionForTooltip,
} from "./AttributeOptionTooltip";

export function ConditionLabel({
  label,
  width = 35,
}: {
  label: string;
  width?: number;
}) {
  return (
    <Flex align="center" flexShrink="0" style={{ width }} mb="1">
      <Text weight="medium" size="medium">
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
  $notRegexi: "$notRegexi",
};

/**
 * Returns the internal object keys used by `condToJson` for a given operator.
 * This is used to detect if two conditions on the same attribute will overwrite each other.
 */
function getSerializationKeys(operator: string): string[] {
  if (
    operator === "$notRegex" ||
    operator === "$notRegexi" ||
    operator === "$notIncludes"
  ) {
    return ["$not"];
  }
  if (operator === "$notExists" || operator === "$exists") {
    return ["$exists"];
  }
  if (operator === "$true" || operator === "$false") {
    return ["$eq"];
  }
  if (operator === "$includes") {
    return ["$elemMatch"];
  }
  if (operator === "$empty" || operator === "$notEmpty") {
    return ["$size"];
  }
  return [operator];
}

export function operatorSupportsCaseInsensitive(operator: string): boolean {
  return OPERATORS_WITH_CASE_INSENSITIVE.has(operator);
}

export function datatypeSupportsCaseInsensitive(datatype?: string): boolean {
  return datatype === "string";
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
  label?: string;
  labelActions?: React.ReactNode;
  locked?: boolean;
  require?: boolean;
  allowNestedSavedGroups?: boolean;
  excludeSavedGroupId?: string;
  slimMode?: boolean;
  addRemoveMode?: boolean;
  addRemoveValue?: "set" | "remove";
  onAddRemoveValueChange?: (value: "set" | "remove") => void;
  onRemoveEffect?: () => void;
  setModeLabel?: string;
  removeModeLabel?: string;
}

export default function ConditionInput({
  defaultValue,
  onChange,
  project,
  labelClassName,
  emptyText = "Applied to everyone by default.",
  label = "Target by Attributes",
  labelActions,
  locked = false,
  require,
  allowNestedSavedGroups,
  excludeSavedGroupId,
  slimMode,
  addRemoveMode,
  addRemoveValue,
  onAddRemoveValueChange,
  onRemoveEffect,
  setModeLabel,
  removeModeLabel,
}: Props) {
  const attributes = useAttributeMap(project);

  const [advanced, setAdvanced] = useState(
    () => jsonToConds(defaultValue, attributes) === null,
  );
  const [simpleAllowed, setSimpleAllowed] = useState(false);
  const [value, setValue] = useState(defaultValue);
  const [conds, setConds] = useState(
    () => jsonToConds(defaultValue, attributes) || [],
  );
  const defaultCodeEditorToggledOn = value.length <= LARGE_FILE_SIZE;
  const [codeEditorToggledOn, setCodeEditorToggledOn] = useState(
    defaultCodeEditorToggledOn,
  );

  const attributeSchema = useAttributeSchema(false, project);
  const showAddRemoveSelector =
    !!addRemoveMode && !!addRemoveValue && !!onAddRemoveValueChange;
  const renderAddRemoveSelector = () =>
    showAddRemoveSelector ? (
      <RadioGroup
        mt="2"
        gap="0"
        value={addRemoveValue}
        setValue={(v) => onAddRemoveValueChange(v as "set" | "remove")}
        options={[
          { value: "set", label: setModeLabel ?? "Set targeting" },
          { value: "remove", label: removeModeLabel ?? "Remove targeting" },
        ]}
        labelSize="2"
      />
    ) : null;

  useEffect(() => {
    if (advanced) return;
    setValue(condToJson(conds, attributes));
  }, [advanced, conds]);

  useEffect(() => {
    onChange(value);
    setSimpleAllowed(jsonToConds(value, attributes) !== null);
  }, [value, attributes]);

  useEffect(() => {
    if (!showAddRemoveSelector || addRemoveValue !== "set") return;
    const isEmpty =
      !conds.length || (conds.length === 1 && (!conds[0] || !conds[0].length));
    if (!isEmpty || !attributeSchema.length) return;
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
  }, [showAddRemoveSelector, addRemoveValue, conds, attributeSchema]);

  const usingDisabledEqualityAttributes = conds.some((cond) =>
    cond.some((c) => !!attributes.get(c.field)?.disableEqualityConditions),
  );
  const isRemoveSelection =
    showAddRemoveSelector && addRemoveValue === "remove";

  if (advanced || !attributes.size || !simpleAllowed) {
    const hasSecureAttributes = some(
      [...attributes].filter(([_, a]) =>
        ["secureString", "secureString[]"].includes(a.datatype),
      ),
    );

    const formatted = formatJSON(value);

    const codeEditorToggleButton = locked ? null : (
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

    const formatJSONButton = locked ? null : (
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
        <CaseInsensitiveRegexWarning value={value} project={project} />
      </>
    );

    return (
      <Box mb="0">
        {" "}
        {(label || labelActions) && (
          <Flex justify="between" align="center" mb="1">
            <Flex gap="2" align="center">
              {slimMode ? (
                <Text as="div" size="medium" weight="semibold" color="text-mid">
                  {label}
                </Text>
              ) : (
                <Text as="div" size="medium" weight="semibold">
                  {label}
                </Text>
              )}
              {!isRemoveSelection && simpleAllowed && attributes.size > 0 && (
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
                  ml="2"
                  disabled={locked}
                />
              )}
            </Flex>
            {labelActions}
          </Flex>
        )}
        {!label && !labelActions && (
          <Flex gap="2" mb="1">
            <Box flexGrow="1">
              {slimMode ? (
                <Text as="div" size="medium" weight="semibold" color="text-mid">
                  Target by Attributes
                </Text>
              ) : (
                <Text as="div" size="medium" weight="semibold">
                  Target by Attributes
                </Text>
              )}
            </Box>
            {!isRemoveSelection && simpleAllowed && attributes.size > 0 && (
              <Box ml="2">
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
                  ml="2"
                  disabled={locked}
                />
              </Box>
            )}
          </Flex>
        )}
        {renderAddRemoveSelector()}
        {!isRemoveSelection && (
          <Box mb="3">
            {codeEditorToggledOn ? (
              <CodeTextArea
                labelClassName={labelClassName}
                language="json"
                value={value}
                setValue={setValue}
                helpText={combinedHelpText}
                resizable={true}
                defaultHeight={FIVE_LINES_HEIGHT}
                showCopyButton={!locked}
                showFullscreenButton={!locked}
                disabled={locked}
              />
            ) : (
              <Field
                size="legacy"
                labelClassName={labelClassName}
                containerClassName="mb-0"
                placeholder=""
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                }}
                textarea
                minRows={1}
                helpText={combinedHelpText}
                disabled={locked}
              />
            )}
          </Box>
        )}
      </Box>
    );
  }

  if (!conds.length || (conds.length === 1 && !conds[0].length)) {
    return (
      <Box my="0">
        {(label || labelActions) && (
          <Flex mb="1" justify="between" align="center">
            {slimMode ? (
              <Text as="div" size="medium" weight="semibold" color="text-mid">
                {label}
              </Text>
            ) : (
              <Text as="div" size="medium" weight="semibold">
                {label}
              </Text>
            )}
            {labelActions}
          </Flex>
        )}
        {!label &&
          !labelActions &&
          (slimMode ? (
            <Text as="div" size="medium" weight="semibold" color="text-mid">
              Target by Attributes
            </Text>
          ) : (
            <Text as="div" size="medium" weight="semibold">
              Target by Attributes
            </Text>
          ))}
        {renderAddRemoveSelector()}
        {!isRemoveSelection && (
          <Box>
            {(!slimMode || !!emptyText?.trim()) && (
              <Text
                color="text-low"
                fontStyle="italic"
                mb="2"
                size={slimMode ? "small" : undefined}
              >
                {emptyText}
              </Text>
            )}
            {!showAddRemoveSelector && (
              <Box mt={slimMode ? "0" : "2"}>
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
                  <Text
                    weight="semibold"
                    size="medium"
                    color={locked ? "text-low" : undefined}
                  >
                    <PiPlusCircleBold className="mr-1" />
                    Add attribute targeting
                  </Text>
                </Link>
              </Box>
            )}
          </Box>
        )}
      </Box>
    );
  }
  return (
    <Box mb="0">
      {(label || labelActions) && (
        <Flex justify="between" align="center" mb="1">
          <Flex gap="2" align="center">
            {slimMode ? (
              <Text as="div" size="medium" weight="semibold" color="text-mid">
                {label}
              </Text>
            ) : (
              <Text as="div" size="medium" weight="semibold">
                {label}
              </Text>
            )}
            {!isRemoveSelection && attributes.size > 0 && (
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
                ml="2"
                disabled={locked}
              />
            )}
          </Flex>
          {labelActions}
        </Flex>
      )}
      {!label && !labelActions && (
        <Flex justify="between" align="center" mb="1">
          {slimMode ? (
            <Text as="div" size="medium" weight="semibold" color="text-mid">
              Target by Attributes
            </Text>
          ) : (
            <Text as="div" size="medium" weight="semibold">
              Target by Attributes
            </Text>
          )}
          {!isRemoveSelection && attributes.size > 0 && (
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
              ml="2"
              disabled={locked}
            />
          )}
        </Flex>
      )}
      {renderAddRemoveSelector()}
      {!isRemoveSelection &&
        conds.map((andGroup, i) => (
          <Box key={i}>
            {i > 0 && <OrSeparator slimMode={slimMode} />}
            <TargetingConditionsCard
              targetingType="attribute"
              total={conds.length}
              slimMode={slimMode}
              addButton={
                attributeSchema.length > 0 ? (
                  <AddConditionButton
                    disabled={locked}
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
                  const hasAnyConditions = newAndGroups.some(
                    (g) => g.length > 0,
                  );
                  if (
                    showAddRemoveSelector &&
                    !hasAnyConditions &&
                    (onRemoveEffect || onAddRemoveValueChange)
                  ) {
                    if (onRemoveEffect) {
                      onRemoveEffect();
                    } else {
                      onAddRemoveValueChange?.("remove");
                    }
                    return;
                  }
                  setConds(newAndGroups);
                }}
                orGroupsCount={conds.length}
                project={project}
                labelClassName={labelClassName}
                emptyText={emptyText}
                label={label}
                require={require}
                allowNestedSavedGroups={allowNestedSavedGroups}
                excludeSavedGroupId={excludeSavedGroupId}
                slimMode={slimMode}
                disabled={locked}
              />
            </TargetingConditionsCard>
          </Box>
        ))}
      {!isRemoveSelection && attributeSchema.length > 0 && (
        <AddOrGroupButton
          slimMode={slimMode}
          disabled={locked}
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
      {!isRemoveSelection && usingDisabledEqualityAttributes && (
        <Callout status="warning" mt="4">
          Be careful not to include Personally Identifiable Information (PII) in
          your targeting conditions.
        </Callout>
      )}
      {!isRemoveSelection && (
        <CaseInsensitiveRegexWarning value={value} project={project} />
      )}
    </Box>
  );
}

function ConditionAndGroupInput({
  conds,
  setConds,
  orGroupsCount,
  disabled = false,
  ...props
}: {
  conds: Condition[];
  setConds: (conds: Condition[]) => void;
  orGroupsCount: number;
  project: string;
  labelClassName?: string;
  emptyText?: string;
  label?: string;
  require?: boolean;
  allowNestedSavedGroups?: boolean;
  excludeSavedGroupId?: string;
  slimMode?: boolean;
  disabled?: boolean;
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
            size="legacy"
            disabled={disabled}
            withRadixThemedPortal
            value={field}
            options={
              props.allowNestedSavedGroups
                ? [
                    {
                      label: "Attributes",
                      options: attributeSchema.map((s) => ({
                        label: s.property,
                        value: s.property,
                        description: s.description,
                        tags: s.tags,
                        datatype: s.datatype,
                        hashAttribute: s.hashAttribute,
                      })),
                    },
                    {
                      label: "Saved Groups",
                      options: [
                        {
                          label: "user is in all saved groups",
                          value: "$savedGroups",
                        },
                        {
                          label: "user is not in the saved groups",
                          value: "$notSavedGroups",
                        },
                      ],
                    },
                  ]
                : attributeSchema.map((s) => ({
                    label: s.property,
                    value: s.property,
                    description: s.description,
                    tags: s.tags,
                    datatype: s.datatype,
                    hashAttribute: s.hashAttribute,
                  }))
            }
            formatOptionLabel={(o, meta) => {
              return (
                <AttributeOptionWithTooltip
                  option={o as AttributeOptionForTooltip}
                  context={meta.context}
                >
                  <Text size="medium">{o.label}</Text>
                </AttributeOptionWithTooltip>
              );
            }}
            name="field"
            onChange={(value) => {
              const newConds = [...conds];
              newConds[i] = { ...newConds[i] };
              newConds[i]["field"] = value;

              const isNewFieldSavedGroup =
                value === "$savedGroups" || value === "$notSavedGroups";
              const isOldFieldSavedGroup =
                field === "$savedGroups" || field === "$notSavedGroups";

              if (isNewFieldSavedGroup) {
                newConds[i]["operator"] =
                  value === "$savedGroups" ? "$in" : "$nin";
                if (!isOldFieldSavedGroup) {
                  newConds[i]["value"] = "";
                }
                setConds(newConds);
                return;
              }
              if (isOldFieldSavedGroup) {
                newConds[i]["value"] = "";
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

        if (field === "$savedGroups" || field === "$notSavedGroups") {
          const groupOptions = savedGroups
            .filter((g) => g.id !== props.excludeSavedGroupId)
            .map((g) => ({
              label: g.groupName,
              value: g.id,
            }));

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
            ...(i > 0
              ? [
                  <Separator
                    key={`sep-${i}`}
                    style={{
                      width: "100%",
                      backgroundColor: "var(--slate-a3)",
                    }}
                  />,
                ]
              : []),
            <ConditionRow
              key={i}
              prefixSlot={
                props.slimMode ? undefined : (
                  <ConditionRowLabel label={i === 0 ? "IF" : "AND"} />
                )
              }
              attributeSlot={fieldSelector}
              valueSlot={
                <MultiSelectField
                  size="legacy"
                  disabled={disabled}
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
                      disabled={disabled}
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
          .filter((g) => g.type === "list" && g.attributeKey === field)
          .filter((group) => {
            return (
              !props.project ||
              !group.projects?.length ||
              group.projects.includes(props.project)
            );
          })
          .map((g) => ({ label: g.groupName, value: g.id }));

        let operatorOptions: OperatorOption[] = getConditionOperators(
          attribute.datatype,
          {
            array: attribute.array,
            enumValues: attribute.enum,
            format: attribute.format,
            savedGroupOptions,
            operator,
          },
        );

        if (attribute.disableEqualityConditions) {
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
          // Load-bearing: this must be checked before the array-field branch so
          // enum-constrained lists get the restricted picker. Relies on
          // useAttributeMap populating `enum` for `[]` datatypes.
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

        const myKeys = getSerializationKeys(operator);
        const willOverwrite = conds.some((c, index) => {
          if (index === i || c.field !== field) return false;
          const theirKeys = getSerializationKeys(c.operator);
          return myKeys.some((k) => theirKeys.includes(k));
        });

        return [
          ...(i > 0
            ? [
                <Separator
                  key={`sep-${i}`}
                  style={{ width: "100%", backgroundColor: "var(--slate-a3)" }}
                />,
              ]
            : []),
          <ConditionRow
            key={i}
            prefixSlot={
              props.slimMode ? undefined : (
                <ConditionRowLabel label={i === 0 ? "IF" : "AND"} />
              )
            }
            attributeSlot={fieldSelector}
            operatorSlot={
              <Flex gap="3" align="start">
                <Box flexGrow="1">
                  <SelectField
                    size="legacy"
                    disabled={disabled}
                    value={getDisplayOperator(operator)}
                    name="operator"
                    options={operatorOptions}
                    sort={false}
                    formatOptionLabel={
                      formatOperatorLabel as FormatOptionLabelType
                    }
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
                        disabled={disabled}
                        variant={
                          isCaseInsensitiveOperator(operator) ? "soft" : "ghost"
                        }
                        size="2"
                        radius="medium"
                        onClick={() => {
                          const newOperator = withOperatorCaseInsensitivity(
                            getDisplayOperator(operator),
                            !isCaseInsensitiveOperator(operator),
                          );
                          handleCondsChange(newOperator, "operator");
                        }}
                        style={{
                          width: 36,
                          height: 36,
                          padding: 0,
                          flexShrink: 0,
                          alignSelf: "center",
                          marginLeft: -4,
                          marginRight: -4,
                        }}
                      >
                        <PiTextAa size={18} />
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
                        size="legacy"
                        disabled={disabled}
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
                        size="legacy"
                        disabled={disabled}
                        containerClassName="w-100"
                        value={value ? value.trim().split(",") : []}
                        onChange={handleListChange}
                        placeholder={
                          attribute?.datatype === "number"
                            ? "1, 2..."
                            : "value 1, value 2..."
                        }
                        delimiters={["Enter", "Tab", ","]}
                        required
                      />
                    </Flex>
                  ) : displayType === "isoCountryCode" ? (
                    <Box style={{ flexBasis: "100%", minWidth: 0 }}>
                      {listOperators.includes(operator) ? (
                        <CountrySelector
                          disabled={disabled}
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
                          disabled={disabled}
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
                          size="legacy"
                          disabled={disabled}
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
                          size="legacy"
                          disabled={disabled}
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
                        size="legacy"
                        disabled={disabled}
                        type="number"
                        step="any"
                        value={value}
                        onChange={handleFieldChange}
                        name="value"
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
                          disabled={disabled}
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
                          size="legacy"
                          disabled={disabled}
                          value={value}
                          onChange={handleFieldChange}
                          name="value"
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
                    disabled={disabled}
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
          willOverwrite && (
            <HelperText key={`warn-${i}`} status="warning" mt="1">
              Warning: This condition conflicts with another condition for the
              same attribute. It will overwrite the previous one in the
              generated JSON. Use &quot;is any of&quot; or &quot;is none
              of&quot; for multiple values.
            </HelperText>
          ),
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
  const hasCaseInsensitiveOperator =
    value.includes('"$regexi"') ||
    value.includes('"$notRegexi"') ||
    value.includes('"$ini"') ||
    value.includes('"$nini"') ||
    value.includes('"$alli"');

  if (!hasCaseInsensitiveOperator) {
    return null;
  }

  return (
    <SDKCapabilityWarning
      capability="caseInsensitiveMembership"
      project={project}
      someMessage="Some of your SDK Connections in this project may not support case-insensitive operators."
      noneMessage="None of your SDK Connections in this project support case-insensitive operators. Either upgrade your SDKs or use case-sensitive operators instead."
      mt="2"
    />
  );
}
