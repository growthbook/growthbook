/* eslint-disable react/no-unescaped-entities */
/* eslint-disable react-hooks/exhaustive-deps */

import { useState, useEffect, useMemo } from "react";
import { FeatureInterface } from "back-end/types/feature";
import { condToJson, jsonToConds } from "@/services/features";
import Tooltip from "@/components/Tooltip/Tooltip";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import CodeTextArea from "../Forms/CodeTextArea";
import StringArrayField from "../Forms/StringArrayField";
import styles from "./ConditionInput.module.scss";
import {RxInfoCircled} from "react-icons/rx";

interface Props {
  defaultValue: string;
  onChange: (value: string) => void;
  parentFeature?: FeatureInterface;
  showPassIfLabel?: boolean;
}

export default function PrerequisiteInput(props: Props) {
  const parentFeature = props.parentFeature;
  const parentFeatureValueType = parentFeature?.valueType;

  const parentValueMap = useMemo(() => {
    const map = new Map();
    if (parentFeatureValueType) {
      map.set("@parent", {
        attribute: "@parent",
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
    () => jsonToConds(props.defaultValue, parentValueMap) === null
  );
  const [simpleAllowed, setSimpleAllowed] = useState(false);
  const [value, setValue] = useState(props.defaultValue);
  const [conds, setConds] = useState(
    () => jsonToConds(props.defaultValue, parentValueMap) || []
  );
  const [rawTextMode, setRawTextMode] = useState(false);

  useEffect(() => {
    if (advanced) return;
    setValue(condToJson(conds, parentValueMap));
  }, [advanced, conds]);

  useEffect(() => {
    props.onChange(value);
    setSimpleAllowed(jsonToConds(value, parentValueMap) !== null);
  }, [value, parentValueMap]);

  if (advanced || !parentValueMap.size || !simpleAllowed) {
    return (
      <div className={`${!props.showPassIfLabel && "ml-2"}`}>
        <CodeTextArea
          label={props.showPassIfLabel ? (<span className="text-main">PASS IF</span>) : undefined}
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
                    <a
                      className="a"
                      role="button"
                      onClick={(e) => {
                        e.preventDefault();
                        const newConds = jsonToConds(value, parentValueMap);
                        // TODO: show error
                        if (newConds === null) return;
                        setConds(newConds);
                        setAdvanced(false);
                      }}
                    >
                      switch to simple mode
                    </a>
                  </div>
                )}
              </div>
              <div className="text-muted mt-1">
                <div>
                  <code>"@parent"</code> refers to the prerequisite&apos;s
                  evaluated value.
                  <Tooltip
                    className="ml-3 text-info hover-underline"
                    body={(
                    <code>{`{"@parent": {"$exists": true}}`}</code>
                  )}>
                    <RxInfoCircled className="mr-1" />Example
                  </Tooltip>
                </div>
                {parentFeatureValueType === "json" && (
                  <div>
                    You may also target specific JSON fields.
                    <Tooltip
                      className="ml-3 text-info hover-underline"
                      body={(
                        <code>{`{"foo.bar": {"$gt": 3}}`}</code>
                      )}>
                      <RxInfoCircled className="mr-1" />Example
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
    <div>
      <ul className={`mb-0 ${styles.conditionslist}`}>
        {conds.map(({ field, operator, value }, i) => {
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
            e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>
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
                  { label: "exists", value: "$exists" },
                  { label: "does not exist", value: "$notExists" },
                ]
              : attribute.datatype === "string"
              ? [
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
                  { label: "exists", value: "$exists" },
                  { label: "does not exist", value: "$notExists" },
                ]
              : attribute.datatype === "number"
              ? [
                  { label: "is equal to", value: "$eq" },
                  { label: "is not equal to", value: "$ne" },
                  { label: "is greater than", value: "$gt" },
                  { label: "is greater than or equal to", value: "$gte" },
                  { label: "is less than", value: "$lt" },
                  { label: "is less than or equal to", value: "$lte" },
                  { label: "is in the list", value: "$in" },
                  { label: "is not in the list", value: "$nin" },
                  { label: "exists", value: "$exists" },
                  { label: "does not exist", value: "$notExists" },
                ]
              : attribute.datatype === "json"
              ? [
                  { label: "exists", value: "$exists" },
                  { label: "does not exist", value: "$notExists" },
                ]
              : [];

          return (
            <li key={i} className={`${styles.listitem} py-0`}>
              <div className={`row ${props.showPassIfLabel ? "ml-3" : "pl-1"} ${styles.listrow}`}>
                {props.showPassIfLabel && (
                  <span className={styles.passif}>PASS IF</span>
                )}
                <div className="col-3">
                  <div className="appbox bg-light mb-0 px-3 py-2">
                    {field === "@parent" ? (
                      <>
                        value
                        <Tooltip
                          className="ml-1"
                          body="The evaluated value of the prerequisite feature"
                        />
                      </>
                    ) : (
                      field
                    )}
                  </div>
                </div>
                <div className="col-sm-12 col-md">
                  <SelectField
                    value={operator}
                    name="operator"
                    options={operatorOptions}
                    sort={false}
                    onChange={(v) => {
                      handleCondsChange(v, "operator");
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
                        textarea
                        value={value}
                        onChange={handleFieldChange}
                        name="value"
                        minRows={1}
                        className={styles.matchingInput}
                        helpText="separate values by comma"
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
                    <a
                      className="a"
                      role="button"
                      style={{ fontSize: "0.8em" }}
                      onClick={(e) => {
                        e.preventDefault();
                        setRawTextMode((prev) => !prev);
                      }}
                    >
                      Switch to {rawTextMode ? "token" : "raw text"} mode
                    </a>
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
            </li>
          );
        })}
      </ul>
      <div className="d-flex align-items-center">
        <a
          role="button"
          className="ml-auto"
          style={{ fontSize: "0.9em" }}
          onClick={(e) => {
            e.preventDefault();
            setAdvanced(true);
          }}
        >
          Advanced mode
        </a>
      </div>
    </div>
  );
}
