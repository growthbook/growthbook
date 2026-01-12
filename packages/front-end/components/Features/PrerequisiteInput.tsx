/* eslint-disable react/no-unescaped-entities */
/* eslint-disable react-hooks/exhaustive-deps */

import { useState, useEffect, useMemo } from "react";
import { FeatureInterface } from "shared/types/feature";
import { RxInfoCircled, RxLoop } from "react-icons/rx";
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
import { ConditionLabel } from "./ConditionInput";

interface Props {
  defaultValue: string;
  onChange: (value: string) => void;
  parentFeature?: FeatureInterface;
  prereqStates?: Record<string, PrerequisiteStateResult> | null;
}

export default function PrerequisiteInput(props: Props) {
  const parentFeature = props.parentFeature;
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
  const [rawTextMode, setRawTextMode] = useState(false);

  useEffect(() => {
    if (advanced) return;
    setValue(condToJson(conds, parentValueMap));
  }, [advanced, conds]);

  useEffect(() => {
    props.onChange(value);
    const conds = jsonToConds(value, parentValueMap);
    setSimpleAllowed(conds !== null && conds.length <= 1);
  }, [value, parentValueMap]);

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
                    className="ml-3 text-info hover-underline"
                    body={<code>{`{"value": {"$gt": 3}}`}</code>}
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
          return;
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
          const name = "value";
          const value: string | number = values.join(",");
          handleCondsChange(value, name);
        };

        const operatorOptions =
          attribute.datatype === "boolean"
            ? [
                { label: "is true", value: "$true" },
                { label: "is false", value: "$false" },
                { label: "is live", value: "$exists" },
                { label: "is not live", value: "$notExists" },
              ]
            : attribute.datatype === "string"
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
                  { label: "is in the list", value: "$in" },
                  { label: "is not in the list", value: "$nin" },
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
                    { label: "is in the list", value: "$in" },
                    { label: "is not in the list", value: "$nin" },
                  ]
                : attribute.datatype === "json"
                  ? [
                      { label: "is live", value: "$exists" },
                      { label: "is not live", value: "$notExists" },
                    ]
                  : [];

        return (
          <Box key={i} mb="4">
            <Flex align="center" gap="2" mb="2">
              <ConditionLabel label="PASS IF" width={60} />
              {!advanced && (
                <Badge label={field} color="gray" radius="full" mr="1" />
              )}
              <Box style={{ minWidth: 200, flex: "1 1 0" }}>
                <SelectField
                  useMultilineLabels={true}
                  value={operator}
                  name="operator"
                  options={operatorOptions}
                  sort={false}
                  onChange={(v) => {
                    handleCondsChange(v, "operator");
                  }}
                  formatOptionLabel={({ value, label }) => {
                    const def =
                      attribute.datatype === "boolean" ? "$true" : "$exists";
                    return (
                      <span>
                        {label}
                        {value === def && (
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
              </Box>
              {[
                "$exists",
                "$notExists",
                "$true",
                "$false",
                "$empty",
                "$notEmpty",
              ].includes(operator) ? (
                <Box style={{ minWidth: 200, flex: "1 1 0" }} />
              ) : ["$in", "$nin"].includes(operator) ? (
                <Flex
                  direction="column"
                  align="end"
                  style={{ minWidth: 200, flex: "1 1 0" }}
                >
                  {rawTextMode ? (
                    <Field
                      textarea
                      value={value}
                      onChange={handleFieldChange}
                      name="value"
                      minRows={1}
                      containerClassName="w-100"
                      helpText={
                        <span className="position-relative" style={{ top: -5 }}>
                          separate values by comma
                        </span>
                      }
                      required
                    />
                  ) : (
                    <StringArrayField
                      containerClassName="w-100"
                      value={value ? value.trim().split(",") : []}
                      onChange={handleListChange}
                      placeholder="Enter some values..."
                      delimiters={["Enter", "Tab"]}
                      required
                    />
                  )}
                  <Link
                    onClick={() => setRawTextMode((prev) => !prev)}
                    style={{ fontSize: "0.8em" }}
                  >
                    Switch to {rawTextMode ? "token" : "raw text"} mode
                  </Link>
                </Flex>
              ) : attribute.enum.length ? (
                <Box style={{ minWidth: 200, flex: "1 1 0" }}>
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
                <Box style={{ minWidth: 200, flex: "1 1 0" }}>
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
              ) : ["string", "secureString"].includes(attribute.datatype) ? (
                <Box style={{ minWidth: 200, flex: "1 1 0" }}>
                  <Field
                    value={value}
                    onChange={handleFieldChange}
                    name="value"
                    style={{ minHeight: 38 }}
                    required
                  />
                </Box>
              ) : null}
            </Flex>
            {!advanced && (
              <Flex justify="end" mt="2">
                <Link onClick={() => setAdvanced(true)}>
                  <RxLoop /> Advanced mode
                </Link>
              </Flex>
            )}
          </Box>
        );
      })}
    </>
  );
}
