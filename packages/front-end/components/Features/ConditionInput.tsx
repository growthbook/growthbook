import React from "react";
import { useState, useEffect } from "react";
import {
  condToJson,
  jsonToConds,
  useAttributeMap,
  useAttributeSchema,
} from "../../services/features";
import Field from "../Forms/Field";
import styles from "./ConditionInput.module.scss";
import { GBAddCircle } from "../Icons";
import SelectField from "../Forms/SelectField";

interface Props {
  defaultValue: string;
  onChange: (value: string) => void;
}

export default function ConditionInput(props: Props) {
  const attributes = useAttributeMap();

  const [advanced, setAdvanced] = useState(
    () => jsonToConds(props.defaultValue, attributes) === null
  );
  const [simpleAllowed, setSimpleAllowed] = useState(false);
  const [value, setValue] = useState(props.defaultValue);
  const [conds, setConds] = useState(() =>
    jsonToConds(props.defaultValue, attributes)
  );

  const attributeSchema = useAttributeSchema();

  useEffect(() => {
    if (advanced) return;
    setValue(condToJson(conds, attributes));
  }, [advanced, conds]);

  useEffect(() => {
    props.onChange(value);
    setSimpleAllowed(jsonToConds(value, attributes) !== null);
  }, [value, attributes]);

  if (advanced || !attributes.size || !simpleAllowed) {
    return (
      <div className="mb-3">
        <Field
          label="Targeting Conditions"
          containerClassName="mb-0"
          textarea
          minRows={1}
          maxRows={12}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          helpText="JSON format using MongoDB query syntax"
        />
        {simpleAllowed && attributes.size && (
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
        )}
      </div>
    );
  }

  if (!conds.length) {
    return (
      <div className="form-group">
        <label className="mb-0">Targeting Conditions</label>
        <div className="m-2">
          <em className="text-muted mr-3">Applied to everyone by default.</em>
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
            Add targeting condition
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="form-group">
      <label>Targeting Conditions</label>
      <div className={`mb-3 bg-light px-3 pb-3 ${styles.conditionbox}`}>
        <ul className={styles.conditionslist}>
          {conds.map(({ field, operator, value }, i) => {
            const attribute = attributes.get(field);

            const onChange = (
              e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>
            ) => {
              const name = e.target.name;
              const value: string | number = e.target.value;

              const newConds = [...conds];
              newConds[i] = { ...newConds[i] };
              newConds[i][name] = value;
              setConds(newConds);
            };

            const onSelectFieldChange = (value: string, name: string) => {
              const newConds = [...conds];
              newConds[i] = { ...newConds[i] };
              newConds[i][name] = value;
              setConds(newConds);
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
                : attribute.enum?.length > 0
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
                    { label: "is in the group", value: "$inGroup" },
                    { label: "is not in the group", value: "$notInGroup" },
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
                    { label: "is in the group", value: "$inGroup" },
                    { label: "is not in the group", value: "$notInGroup" },
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
                      }))}
                      name="field"
                      className={`${styles.firstselect} form-control`}
                      onChange={(value) => {
                        const newConds = [...conds];
                        newConds[i] = { ...newConds[i] };
                        newConds[i]["field"] = value;

                        const newAttribute = attributes.get(value);
                        if (newAttribute.datatype !== attribute.datatype) {
                          if (newAttribute.datatype === "boolean") {
                            newConds[i]["operator"] = "$true";
                          } else {
                            newConds[i]["operator"] = "$eq";
                            newConds[i]["value"] = newConds[i]["value"] || "";
                          }
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
                      onChange={(v) => {
                        onSelectFieldChange(v, "operator");
                      }}
                      className="form-control"
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
                  ) : ["$inGroup", "$notInGroup"].includes(operator) ? (
                    <SelectField
                      options={attribute.enum.map((v) => ({
                        label: v,
                        value: v,
                      }))}
                      value={value}
                      onChange={(v) => {
                        onSelectFieldChange(v, "value");
                      }}
                      name="value"
                      initialOption="Choose group..."
                      containerClassName="col-sm-12 col-md mb-2"
                    />
                  ) : ["$in", "$nin"].includes(operator) ? (
                    <Field
                      textarea
                      value={value}
                      onChange={onChange}
                      name="value"
                      minRows={1}
                      className={styles.matchingInput}
                      containerClassName="col-sm-12 col-md mb-2"
                      helpText="separate values by comma"
                    />
                  ) : attribute.enum.length ? (
                    <SelectField
                      options={attribute.enum.map((v) => ({
                        label: v,
                        value: v,
                      }))}
                      value={value}
                      onChange={(v) => {
                        onSelectFieldChange(v, "value");
                      }}
                      name="value"
                      initialOption="Choose One..."
                      containerClassName="col-sm-12 col-md mb-2"
                    />
                  ) : attribute.datatype === "number" ? (
                    <Field
                      type="number"
                      step="any"
                      value={value}
                      onChange={onChange}
                      name="value"
                      className={styles.matchingInput}
                      containerClassName="col-sm-12 col-md mb-2"
                    />
                  ) : attribute.datatype === "string" ? (
                    <Field
                      value={value}
                      onChange={onChange}
                      name="value"
                      className={styles.matchingInput}
                      containerClassName="col-sm-12 col-md mb-2"
                    />
                  ) : (
                    ""
                  )}
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
                </div>
              </li>
            );
          })}
        </ul>
        <div className="d-flex align-items-center">
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
          <a
            href="#"
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
    </div>
  );
}
