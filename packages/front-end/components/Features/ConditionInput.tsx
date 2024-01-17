import { useState, useEffect, useMemo } from "react";
import { some } from "lodash";
import { FaExclamationCircle } from "react-icons/fa";
import { FeatureInterface } from "back-end/types/feature";
import {
  condToJson,
  jsonToConds,
  useAttributeMap,
  useAttributeSchema,
  getDefaultOperator,
  getDefaultPrerequisiteParentCondition,
} from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import Field from "../Forms/Field";
import { GBAddCircle } from "../Icons";
import SelectField from "../Forms/SelectField";
import CodeTextArea from "../Forms/CodeTextArea";
import StringArrayField from "../Forms/StringArrayField";
import styles from "./ConditionInput.module.scss";

interface Props {
  defaultValue: string;
  onChange: (value: string) => void;
  labelClassName?: string;
  emptyText?: string;
  title?: string;
  require?: boolean;
  isPrerequisite?: boolean;
  parentFeature?: FeatureInterface;
}

export default function ConditionInput(props: Props) {
  const isPrerequisite = !!props.isPrerequisite;
  const parentFeature = props.parentFeature;
  const parentFeatureValueType = parentFeature?.valueType;

  const { savedGroups } = useDefinitions();

  const attributeMap = useAttributeMap();
  const parentValueMap = useMemo(() => {
    const map = new Map();
    // todo: JSON type prereq values?
    if (isPrerequisite && parentFeatureValueType) {
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
  }, [isPrerequisite, parentFeatureValueType]);

  const attributes = !isPrerequisite ? attributeMap : parentValueMap;

  const title =
    props.title ||
    (!isPrerequisite ? "Target by Attribute" : "Target by parent value");
  const emptyText = props.emptyText || "Applied to everyone by default.";

  const [advanced, setAdvanced] = useState(
    () =>
      !isPrerequisite && jsonToConds(props.defaultValue, attributes) === null
  );
  const [simpleAllowed, setSimpleAllowed] = useState(false);
  const [value, setValue] = useState(props.defaultValue);
  const [conds, setConds] = useState(
    () => jsonToConds(props.defaultValue, attributes) || []
  );
  const [rawTextMode, setRawTextMode] = useState(false);

  const attributeSchema = useAttributeSchema();

  useEffect(() => {
    if (advanced) return;
    setValue(condToJson(conds, attributes));
  }, [advanced, conds]);

  useEffect(() => {
    props.onChange(value);
    setSimpleAllowed(jsonToConds(value, attributes) !== null);
  }, [value, attributes]);

  useEffect(() => {
    if (isPrerequisite && parentFeature) {
      const condStr = getDefaultPrerequisiteParentCondition(parentFeature);
      const newConds = jsonToConds(condStr);
      if (newConds === null) return;
      setConds(newConds);
    }
  }, [isPrerequisite, parentFeature, setConds]);

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
      <div className="mb-3">
        <CodeTextArea
          label={title}
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
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        const newConds = jsonToConds(value, attributes);
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
    );
  }

  if (!conds.length) {
    return (
      <div className="form-group">
        <label className={props.labelClassName || ""}>{title}</label>
        <div className={`mb-3 bg-light p-3 ${styles.conditionbox}`}>
          <em className="text-muted mr-3">{emptyText}</em>
          <a
            href="#"
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
            Add attribute targeting
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="form-group">
      <label className={props.labelClassName || ""}>{title}</label>
      <div
        className={`mb-3 bg-light px-3 ${!isPrerequisite && "pb-3"} ${
          styles.conditionbox
        }`}
      >
        <ul className={`${isPrerequisite && "mb-0"} ${styles.conditionslist}`}>
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
                    { label: "exists", value: "$exists" },
                    { label: "does not exist", value: "$notExists" },
                  ]
                : attribute.array
                ? [
                    { label: "includes", value: "$includes" },
                    { label: "does not include", value: "$notIncludes" },
                    { label: "is empty", value: "$empty" },
                    { label: "is not empty", value: "$notEmpty" },
                    { label: "exists", value: "$exists" },
                    { label: "does not exist", value: "$notExists" },
                  ]
                : attribute.enum?.length || 0 > 0
                ? [
                    { label: "is equal to", value: "$eq" },
                    { label: "is not equal to", value: "$ne" },
                    { label: "is in the list", value: "$in" },
                    { label: "is not in the list", value: "$nin" },
                    { label: "exists", value: "$exists" },
                    { label: "does not exist", value: "$notExists" },
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
                    { label: "exists", value: "$exists" },
                    { label: "does not exist", value: "$notExists" },
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
                    { label: "exists", value: "$exists" },
                    { label: "does not exist", value: "$notExists" },
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
                    { label: "exists", value: "$exists" },
                    { label: "does not exist", value: "$notExists" },
                    ...(savedGroupOptions.length > 0
                      ? savedGroupOperators
                      : []),
                  ]
                : attribute.datatype === "json"
                ? // todo: sub-item matching?
                  [
                    { label: "exists", value: "$exists" },
                    { label: "does not exist", value: "$notExists" },
                  ]
                : [];

            return (
              <li key={i} className={styles.listitem}>
                <div
                  className={`row ${styles.listrow} d-flex align-items-center`}
                >
                  {i > 0 ? (
                    <span className={`${styles.and} mr-2`}>AND</span>
                  ) : (
                    <span className={`${styles.and} mr-2`}>IF</span>
                  )}
                  <div className="col-sm-12 col-md mb-2">
                    {field === "@parent" ? (
                      <div className="appbox bg-light mb-0 px-3 py-2">
                        {field.replace("@parent", "value")}
                        {field === "@parent" && (
                          <Tooltip
                            className="ml-1"
                            body="The evaluated value of the prerequisite feature"
                          />
                        )}
                      </div>
                    ): (
                    <SelectField
                      value={field}
                      options={
                        !isPrerequisite
                          ? attributeSchema.map((s) => ({
                              label: s.property,
                              value: s.property,
                            }))
                          : [
                              // todo: JSON type prereqs?
                              { label: "@parent", value: "@parent" },
                            ]
                      }
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
                      isSearchable={!isPrerequisite}
                      disabled={isPrerequisite}
                    />)}
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
                        href="#"
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
                  {!isPrerequisite && (conds.length > 1 || !props.require) && (
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
                        remove
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {!isPrerequisite && (
        <div className="d-flex align-items-center">
          {attributeSchema.length > 0 && (
            <a
              className={`mr-3 btn btn-outline-primary ${styles.addcondition}`}
              href="#"
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
              <span
                className={`h4 pr-2 m-0 d-inline-block align-top ${styles.addicon}`}
              >
                <GBAddCircle />
              </span>
              Add another condition
            </a>
          )}
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
        )}
      </div>
    </div>
  );
}
