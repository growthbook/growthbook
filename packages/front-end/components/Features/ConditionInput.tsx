/* eslint-disable react-hooks/exhaustive-deps */

import React, { useState, useEffect } from "react";
import { some } from "lodash";
import {
  FaExclamationCircle,
  FaMinusCircle,
  FaPlusCircle,
} from "react-icons/fa";
import { RxLoop } from "react-icons/rx";
import {
  condToJson,
  jsonToConds,
  useAttributeMap,
  useAttributeSchema,
  getDefaultOperator,
} from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import StringArrayField from "@/components/Forms/StringArrayField";
import styles from "./ConditionInput.module.scss";

interface Props {
  defaultValue: string;
  onChange: (value: string) => void;
  project: string;
  labelClassName?: string;
  emptyText?: string;
  title?: string;
  require?: boolean;
}

export default function ConditionInput(props: Props) {
  const { savedGroups } = useDefinitions();

  const attributes = useAttributeMap(props.project);

  const title = props.title || "Target by Attributes";
  const emptyText = props.emptyText || "Applied to everyone by default.";

  const [advanced, setAdvanced] = useState(
    () => jsonToConds(props.defaultValue, attributes) === null
  );
  const [simpleAllowed, setSimpleAllowed] = useState(false);
  const [value, setValue] = useState(props.defaultValue);
  const [conds, setConds] = useState(
    () => jsonToConds(props.defaultValue, attributes) || []
  );
  const [rawTextMode, setRawTextMode] = useState(false);

  const attributeSchema = useAttributeSchema(false, props.project);

  useEffect(() => {
    if (advanced) return;
    setValue(condToJson(conds, attributes));
  }, [advanced, conds]);

  useEffect(() => {
    props.onChange(value);
    setSimpleAllowed(jsonToConds(value, attributes) !== null);
  }, [value, attributes]);

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

  if (advanced || !attributes.size || !simpleAllowed) {
    const hasSecureAttributes = some(
      [...attributes].filter(([_, a]) =>
        ["secureString", "secureString[]"].includes(a.datatype)
      )
    );
    return (
      <div className="form-group my-4">
        <label className={props.labelClassName || ""}>{title}</label>
        <div className="appbox bg-light px-3 py-3">
          <CodeTextArea
            labelClassName={props.labelClassName}
            language="json"
            value={value}
            setValue={setValue}
            helpText={
              <>
                <div className="d-flex">
                  <div>JSON format using MongoDB query syntax.</div>
                  {simpleAllowed && attributes.size && (
                    <div className="ml-auto">
                      <span
                        className="link-purple cursor-pointer"
                        onClick={(e) => {
                          e.preventDefault();
                          const newConds = jsonToConds(value, attributes);
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
                {hasSecureAttributes && (
                  <div className="mt-1 text-warning-orange">
                    <FaExclamationCircle /> Secure attribute hashing not
                    guaranteed to work for complicated rules
                  </div>
                )}
              </>
            }
          />
        </div>
      </div>
    );
  }

  if (!conds.length) {
    return (
      <div className="form-group my-4">
        <label className={props.labelClassName || ""}>{title}</label>
        <div>
          <div className="font-italic text-muted mr-3">{emptyText}</div>
          <div
            className="d-inline-block ml-1 mt-2 link-purple font-weight-bold cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              const prop = attributeSchema[0];
              setConds([
                {
                  field: prop?.property || "",
                  operator: prop?.datatype === "boolean" ? "$true" : "$eq",
                  value: "",
                },
              ]);
            }}
          >
            <FaPlusCircle className="mr-1" />
            Add attribute targeting
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="form-group my-4">
      <label className={props.labelClassName || ""}>{title}</label>
      <div className="appbox bg-light px-3 pb-3">
        <ul className={styles.conditionslist}>
          {conds.map(({ field, operator, value }, i) => {
            const attribute = attributes.get(field);

            if (!attribute) {
              console.error("Attribute not found in attribute Map.");
              return;
            }

            const savedGroupOptions = savedGroups
              // First, limit to groups with the correct attribute
              .filter((g) => g.type === "list" && g.attributeKey === field)
              // Then, transform into the select option format
              .map((g) => ({ label: g.groupName, value: g.id }));

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
                    { label: "is in the list", value: "$in" },
                    { label: "is not in the list", value: "$nin" },
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
                    { label: "matches regex", value: "$regex" },
                    { label: "does not match regex", value: "$notRegex" },
                    {
                      label: "is greater than",
                      value: attribute.format === "version" ? "$vgt" : "$gt",
                    },
                    {
                      label: "is greater than or equal to",
                      value: attribute.format === "version" ? "$vgte" : "$gte",
                    },
                    {
                      label: "is less than",
                      value: attribute.format === "version" ? "$vlt" : "$lt",
                    },
                    {
                      label: "is less than or equal to",
                      value: attribute.format === "version" ? "$vlte" : "$lte",
                    },
                    { label: "is in the list", value: "$in" },
                    { label: "is not in the list", value: "$nin" },
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
                    { label: "is in the list", value: "$in" },
                    { label: "is not in the list", value: "$nin" },
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
                    { label: "is greater than or equal to", value: "$gte" },
                    { label: "is less than", value: "$lt" },
                    { label: "is less than or equal to", value: "$lte" },
                    { label: "is in the list", value: "$in" },
                    { label: "is not in the list", value: "$nin" },
                    { label: "is not NULL", value: "$exists" },
                    { label: "is NULL", value: "$notExists" },
                    ...(savedGroupOptions.length > 0
                      ? savedGroupOperators
                      : []),
                  ]
                : [];

            return (
              <li key={i} className={styles.listitem}>
                <div className={`row ${styles.listrow}`}>
                  {i > 0 ? (
                    <span className={`${styles.and} mr-2`}>AND</span>
                  ) : (
                    <span className={`${styles.and} mr-2`}>IF</span>
                  )}
                  <div className="col-sm-12 col-md mb-2">
                    <SelectField
                      value={field}
                      options={attributeSchema.map((s) => ({
                        label: s.property,
                        value: s.property,
                        tooltip: s.description || "",
                      }))}
                      formatOptionLabel={(o) => (
                        <span title={o.tooltip}>{o.label}</span>
                      )}
                      name="field"
                      className={styles.firstselect}
                      onChange={(value) => {
                        const newConds = [...conds];
                        newConds[i] = { ...newConds[i] };
                        newConds[i]["field"] = value;

                        const newAttribute = attributes.get(value);
                        const hasAttrChanged =
                          newAttribute?.datatype !== attribute.datatype ||
                          newAttribute?.array !== attribute.array;
                        if (hasAttrChanged && newAttribute) {
                          newConds[i]["operator"] = getDefaultOperator(
                            newAttribute
                          );
                          newConds[i]["value"] = newConds[i]["value"] || "";
                        }
                        setConds(newConds);
                      }}
                    />
                  </div>
                  <div className="col-sm-12 col-md mb-2">
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
                  ) : ["$inGroup", "$notInGroup"].includes(operator) &&
                    savedGroupOptions.length > 0 ? (
                    <SelectField
                      options={savedGroupOptions}
                      value={value}
                      onChange={(v) => {
                        handleCondsChange(v, "value");
                      }}
                      name="value"
                      initialOption="Choose group..."
                      containerClassName="col-sm-12 col-md mb-2"
                      required
                    />
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
                          helpText={
                            <span
                              className="position-relative"
                              style={{ top: -5 }}
                            >
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
                      containerClassName="col-sm-12 col-md mb-2"
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
                      containerClassName="col-sm-12 col-md mb-2"
                      required
                    />
                  ) : ["string", "secureString"].includes(
                      attribute.datatype
                    ) ? (
                    <Field
                      value={value}
                      onChange={handleFieldChange}
                      name="value"
                      className={styles.matchingInput}
                      containerClassName="col-sm-12 col-md mb-2"
                      required
                    />
                  ) : (
                    ""
                  )}
                  {(conds.length > 1 || !props.require) && (
                    <div className="col-md-auto col-sm-12">
                      <button
                        className="btn btn-link text-danger float-right"
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          const newConds = [...conds];
                          newConds.splice(i, 1);
                          setConds(newConds);
                        }}
                      >
                        <FaMinusCircle className="mr-1" />
                        remove
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="d-flex align-items-center">
          {attributeSchema.length > 0 && (
            <span
              className="link-purple font-weight-bold cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                const prop = attributeSchema[0];
                setConds([
                  ...conds,
                  {
                    field: prop?.property || "",
                    operator: prop?.datatype === "boolean" ? "$true" : "$eq",
                    value: "",
                  },
                ]);
              }}
            >
              <FaPlusCircle className="mr-1" />
              Add another condition
            </span>
          )}
          <span
            className="ml-auto link-purple cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              setAdvanced(true);
            }}
          >
            <RxLoop /> Advanced mode
          </span>
        </div>
      </div>
    </div>
  );
}
