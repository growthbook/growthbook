/* eslint-disable react/no-unescaped-entities */

import React, { useState, useEffect, useMemo } from "react";
import { RxInfoCircled, RxLoop } from "react-icons/rx";

export interface MinimalFeatureInfo {
  id?: string;
  valueType: "boolean" | "string" | "number" | "json";
  project?: string;
  defaultValue?: string;
}
import { FaMagic } from "react-icons/fa";
import { PrerequisiteStateResult } from "shared/util";
import { Box, Flex, Text } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import { condToJson, jsonToConds, formatJSON } from "@/services/features";
import Tooltip from "@/components/Tooltip/Tooltip";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import StringArrayField from "@/components/Forms/StringArrayField";
import Link from "@/ui/Link";
import Checkbox from "@/ui/Checkbox";
import {
  CaseInsensitiveRegexWarning,
  operatorSupportsCaseInsensitive,
  datatypeSupportsCaseInsensitive,
  getDisplayOperator,
  isCaseInsensitiveOperator,
  withOperatorCaseInsensitivity,
} from "./ConditionInput";

interface Props {
  defaultValue: string;
  onChange: (value: string) => void;
  parentFeature?: MinimalFeatureInfo;
  prereqStates?: Record<string, PrerequisiteStateResult> | null;
}

export default function PrerequisiteInput(props: Props) {
  const { onChange, parentFeature } = props;
  const parentFeatureValueType = parentFeature?.valueType;

  const parentValueMap = useMemo(() => {
    const map = new Map();
    if (parentFeatureValueType) {
      map.set("value", {
        attribute: "value",
        datatype: parentFeatureValueType,
        array: false,
        identifier: false,
        enum: [],
        archived: false,
      });
    }
    return map;
  }, [parentFeatureValueType]);

  const [advanced, setAdvanced] = useState(
    () => jsonToConds(props.defaultValue, parentValueMap) === null,
  );
  const [simpleAllowed, setSimpleAllowed] = useState(false);
  const [value, setValue] = useState(props.defaultValue);
  const [conds, setConds] = useState(
    () => jsonToConds(props.defaultValue, parentValueMap) || [],
  );
  useEffect(() => {
    if (advanced) return;
    setValue(condToJson(conds, parentValueMap));
  }, [advanced, conds, parentValueMap]);

  useEffect(() => {
    onChange(value);
    const conds = jsonToConds(value, parentValueMap);
    setSimpleAllowed(conds !== null && conds.length <= 1);
  }, [value, parentValueMap, onChange]);

  // Normalize: secureString/secureString[] only support exact operators (in/nin), not case-insensitive (ini/nini)
  useEffect(() => {
    let changed = false;
    const next = conds.map((group) =>
      group.map((c) => {
        const attr = parentValueMap.get(c.field);
        if (
          attr &&
          ["secureString", "secureString[]"].includes(attr.datatype) &&
          isCaseInsensitiveOperator(c.operator)
        ) {
          changed = true;
          return { ...c, operator: getDisplayOperator(c.operator) };
        }
        return c;
      }),
    );
    if (changed) setConds(next);
  }, [conds, parentValueMap]);

  if (advanced || !parentValueMap.size || !simpleAllowed) {
    const formatted = formatJSON(value);

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

    return (
      <Box>
        <Text weight="medium" size="2" mb="2" style={{ display: "block" }}>
          PASS IF
        </Text>
        <CodeTextArea
          language="json"
          value={value}
          setValue={setValue}
          minLines={3}
          maxLines={6}
          helpText={
            <>
              <Flex justify="between" align="center">
                <Text>JSON format using MongoDB query syntax.</Text>
                <Flex gap="3">
                  {formatJSONButton}
                  {simpleAllowed && (
                    <Link
                      onClick={() => {
                        const newConds = jsonToConds(value, parentValueMap);
                        // TODO: show error
                        if (newConds === null) return;
                        setConds(newConds);
                        setAdvanced(false);
                      }}
                    >
                      <RxLoop /> Simple mode
                    </Link>
                  )}
                </Flex>
              </Flex>
              <Box mt="2">
                <Text color="gray" size="2">
                  <code>"value"</code> refers to the prerequisite&apos;s
                  evaluated value.
                  <Tooltip
                    className="ml-2 text-info hover-underline"
                    body={<code>{`{"value": {"$gt": 3}}`}</code>}
                    flipTheme={false}
                  >
                    <RxInfoCircled className="mr-1" />
                    Example
                  </Tooltip>
                </Text>
                {parentFeatureValueType === "json" && (
                  <Text
                    color="gray"
                    size="2"
                    mt="1"
                    style={{ display: "block" }}
                  >
                    You may also target specific JSON fields.
                    <Tooltip
                      className="ml-3 text-info hover-underline"
                      body={<code>{`{"value.foo.bar": {"$gt": 3}}`}</code>}
                    >
                      <RxInfoCircled className="mr-1" />
                      Example
                    </Tooltip>
                  </Text>
                )}
              </Box>
              <CaseInsensitiveRegexWarning
                value={value}
                project={parentFeature?.project}
              />
            </>
          }
        />
      </Box>
    );
  }

  return (
    <>
      {conds[0]?.map(({ field, operator, value }, i) => {
        const attribute = parentValueMap.get(field);

        if (!attribute) {
          console.error("Attribute not found in attribute Map.");
          return null;
        }

        const handleCondsChange = (value: string, name: string) => {
          const newConds = [...conds[0]];
          newConds[i] = { ...newConds[i] };
          newConds[i][name] = value;
          setConds([newConds]);
        };

        const handleFieldChange = (
          e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>,
        ) => {
          const name = e.target.name;
          const value: string | number = e.target.value;
          handleCondsChange(value, name);
        };

        const handleListChange = (values: string[]) => {
          handleCondsChange(values.join(","), "value");
        };

        const operatorOptions =
          attribute.datatype === "boolean"
            ? [
                { label: "is true", value: "$true" },
                { label: "is false", value: "$false" },
                { label: "is live", value: "$exists" },
                { label: "is not live", value: "$notExists" },
              ]
            : attribute.datatype === "string" ||
                attribute.datatype === "secureString" ||
                attribute.datatype === "secureString[]"
              ? [
                  { label: "is live", value: "$exists" },
                  { label: "is not live", value: "$notExists" },
                  { label: "is equal to", value: "$eq" },
                  { label: "is not equal to", value: "$ne" },
                  { label: "matches regex", value: "$regex" },
                  { label: "does not match regex", value: "$notRegex" },
                  { label: "is greater than", value: "$gt" },
                  { label: "is greater than or equal to", value: "$gte" },
                  { label: "is less than", value: "$lt" },
                  { label: "is less than or equal to", value: "$lte" },
                  { label: "is any of", value: "$in" },
                  { label: "is none of", value: "$nin" },
                ]
              : attribute.datatype === "number"
                ? [
                    { label: "is live", value: "$exists" },
                    { label: "is not live", value: "$notExists" },
                    { label: "is equal to", value: "$eq" },
                    { label: "is not equal to", value: "$ne" },
                    { label: "is greater than", value: "$gt" },
                    { label: "is greater than or equal to", value: "$gte" },
                    { label: "is less than", value: "$lt" },
                    { label: "is less than or equal to", value: "$lte" },
                    { label: "is any of", value: "$in" },
                    { label: "is none of", value: "$nin" },
                  ]
                : attribute.datatype === "json"
                  ? [
                      { label: "is live", value: "$exists" },
                      { label: "is not live", value: "$notExists" },
                    ]
                  : [];

        const needsValueInput = ![
          "$exists",
          "$notExists",
          "$true",
          "$false",
          "$empty",
          "$notEmpty",
        ].includes(operator);

        const needsCaseInsensitive =
          operatorSupportsCaseInsensitive(operator) &&
          datatypeSupportsCaseInsensitive(attribute?.datatype);

        return (
          <React.Fragment key={i}>
            {/* Operator and optional case insensitive checkbox */}
            <Flex gap="2" align="start" wrap="wrap">
              <Box style={{ flexShrink: 0 }} mt="2">
                <Badge label="VALUE" color="gray" radius="full" />
              </Box>
              <Box style={{ minWidth: 200, flex: "1 1 0" }}>
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
                    formatOptionLabel={({ value: v, label }) => {
                      const def =
                        attribute.datatype === "boolean" ? "$true" : "$exists";
                      return (
                        <span>
                          {label}
                          {v === def && (
                            <Text
                              color="gray"
                              size="1"
                              style={{
                                float: "right",
                                position: "relative",
                                top: 3,
                                textTransform: "uppercase",
                              }}
                            >
                              default
                            </Text>
                          )}
                        </span>
                      );
                    }}
                  />
                  {needsCaseInsensitive && (
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

              {/* Value input if needed */}
              {needsValueInput &&
                (["$in", "$nin", "$ini", "$nini"].includes(operator) ? (
                  <Box style={{ minWidth: 400, flex: "2 1 0" }}>
                    <StringArrayField
                      containerClassName="w-100"
                      value={value ? value.trim().split(",") : []}
                      onChange={handleListChange}
                      placeholder="value 1, value 2, value 3..."
                      delimiters={["Enter", "Tab"]}
                      enableRawTextMode
                      required
                    />
                  </Box>
                ) : attribute.enum.length ? (
                  <Box style={{ minWidth: 400, flex: "2 1 0" }}>
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
                  </Box>
                ) : attribute.datatype === "number" ? (
                  <Box style={{ minWidth: 400, flex: "2 1 0" }}>
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
                ) : ["string", "secureString", "secureString[]"].includes(
                    attribute.datatype,
                  ) ? (
                  <Box style={{ minWidth: 400, flex: "2 1 0" }}>
                    <Field
                      value={value}
                      onChange={handleFieldChange}
                      name="value"
                      style={{ minHeight: 38 }}
                      required
                    />
                  </Box>
                ) : null)}
            </Flex>

            {/* Advanced mode link */}
            {!advanced && (
              <Flex justify="end" mt="2">
                <Link onClick={() => setAdvanced(true)}>
                  <RxLoop /> Advanced mode
                </Link>
              </Flex>
            )}
          </React.Fragment>
        );
      })}
      <CaseInsensitiveRegexWarning
        value={value}
        project={parentFeature?.project}
      />
    </>
  );
}
