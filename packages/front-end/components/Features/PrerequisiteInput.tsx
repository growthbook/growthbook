/* eslint-disable react/no-unescaped-entities */
/* eslint-disable react-hooks/exhaustive-deps */

import { useState, useEffect, useMemo } from "react";
import { FeatureInterface } from "shared/types/feature";
import { RxInfoCircled, RxLoop } from "react-icons/rx";
import { PrerequisiteStateResult } from "shared/util";
import { condToJson, jsonToConds } from "@/services/features";
import Tooltip from "@/components/Tooltip/Tooltip";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import StringArrayField from "@/components/Forms/StringArrayField";
import styles from "./ConditionInput.module.scss";

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
    return (
      <div>
        <div className={`mb-2 ${styles.passif}`}>PASS IF</div>
        <CodeTextArea
          language="json"
          value={value}
          setValue={setValue}
          minLines={3}
          maxLines={6}
          helpText={
            <>
              <div className="d-flex">
                <div>JSON format using MongoDB query syntax.</div>
                {simpleAllowed && (
                  <div className="ml-auto">
                    <span
                      className="link-purple cursor-pointer"
                      onClick={(e) => {
                        e.preventDefault();
                        const newConds = jsonToConds(value, parentValueMap);
                        // TODO: show error
                        if (newConds === null) return;
                        setConds(newConds);
                        setAdvanced(false);
                      }}
                    >
                      <RxLoop /> Simple mode
                    </span>
                  </div>
                )}
              </div>
              <div className="text-muted mt-1">
                <div>
                  <code>"value"</code> refers to the prerequisite&apos;s
                  evaluated value.
                  <Tooltip
                    className="ml-3 text-info hover-underline"
                    body={<code>{`{"value": {"$gt": 3}}`}</code>}
                  >
                    <RxInfoCircled className="mr-1" />
                    Example
                  </Tooltip>
                </div>
                {parentFeatureValueType === "json" && (
                  <div>
                    You may also target specific JSON fields.
                    <Tooltip
                      className="ml-3 text-info hover-underline"
                      body={<code>{`{"value.foo.bar": {"$gt": 3}}`}</code>}
                    >
                      <RxInfoCircled className="mr-1" />
                      Example
                    </Tooltip>
                  </div>
                )}
              </div>
            </>
          }
        />
      </div>
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
          <div key={i}>
            <div className="d-flex align-items-center mb-2">
              <div className={styles.passif}>PASS IF</div>
              {!advanced && (
                <div className="ml-2">
                  <div className="border rounded bg-main-color mb-0 px-2 py-0">
                    {field}
                  </div>
                </div>
              )}
            </div>
            <div className="row">
              <div className="col-sm-12 col-md">
                <SelectField
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
                          <span
                            className="text-muted uppercase-title float-right position-relative"
                            style={{ top: 3 }}
                          >
                            default
                          </span>
                        )}
                      </span>
                    );
                  }}
                />
              </div>
              {[
                "$exists",
                "$notExists",
                "$true",
                "$false",
                "$empty",
                "$notEmpty",
              ].includes(operator) ? (
                ""
              ) : ["$in", "$nin"].includes(operator) ? (
                <div className="d-flex align-items-end flex-column col-sm-12 col-md mb-1">
                  {rawTextMode ? (
                    <Field
                      containerClassName="w-100"
                      textarea
                      value={value}
                      onChange={handleFieldChange}
                      name="value"
                      minRows={1}
                      className={styles.matchingInput}
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
                  <span
                    className="link-purple cursor-pointer"
                    style={{ fontSize: "0.8em" }}
                    onClick={(e) => {
                      e.preventDefault();
                      setRawTextMode((prev) => !prev);
                    }}
                  >
                    Switch to {rawTextMode ? "token" : "raw text"} mode
                  </span>
                </div>
              ) : attribute.enum.length ? (
                <SelectField
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
                  containerClassName="col-sm-12 col-md"
                  required
                />
              ) : attribute.datatype === "number" ? (
                <Field
                  type="number"
                  step="any"
                  value={value}
                  onChange={handleFieldChange}
                  name="value"
                  className={styles.matchingInput}
                  containerClassName="col-sm-12 col-md"
                  required
                />
              ) : ["string", "secureString"].includes(attribute.datatype) ? (
                <Field
                  value={value}
                  onChange={handleFieldChange}
                  name="value"
                  className={styles.matchingInput}
                  containerClassName="col-sm-12 col-md"
                  required
                />
              ) : (
                ""
              )}
            </div>
            {!advanced && (
              <div className="d-flex mt-1">
                <div className="flex-1" />
                <span
                  className="link-purple cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    setAdvanced(true);
                  }}
                >
                  <RxLoop /> Advanced mode
                </span>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
