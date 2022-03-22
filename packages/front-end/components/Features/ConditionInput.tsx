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
            return (
              <li key={i} className={styles.listitem}>
                <div className={`row ${styles.listrow}`}>
                  {i > 0 ? (
                    <span className={`${styles.and} mr-2`}>AND</span>
                  ) : (
                    <span className={`${styles.and} mr-2`}>IF</span>
                  )}
                  <div className="col-sm-12 col-md mb-2">
                    <select
                      value={field}
                      name="field"
                      onChange={(e) => {
                        const value: string | number = e.target.value;

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
                      className={`${styles.firstselect} form-control`}
                    >
                      {attributeSchema.map((s) => (
                        <option key={s.property}>{s.property}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-sm-12 col-md mb-2">
                    <select
                      value={operator}
                      name="operator"
                      onChange={onChange}
                      className="form-control"
                    >
                      {attribute.datatype === "boolean" ? (
                        <>
                          <option value="$true">is true</option>
                          <option value="$false">is false</option>
                          <option value="$exists">exists</option>
                          <option value="$notExists">does not exist</option>
                        </>
                      ) : attribute.array ? (
                        <>
                          <option value="$includes">includes</option>
                          <option value="$notIncludes">does not include</option>
                          <option value="$exists">exists</option>
                          <option value="$notExists">does not exist</option>
                        </>
                      ) : attribute.enum?.length > 0 ? (
                        <>
                          <option value="$eq">is equal to</option>
                          <option value="$ne">is not equal to</option>
                          <option value="$in">is in the list</option>
                          <option value="$nin">is not in the list</option>
                          <option value="$exists">exists</option>
                          <option value="$notExists">does not exist</option>
                        </>
                      ) : attribute.datatype === "string" ? (
                        <>
                          <option value="$eq">is equal to</option>
                          <option value="$ne">is not equal to</option>
                          <option value="$regex">matches regex</option>
                          <option value="$notRegex">
                            does not match regex
                          </option>
                          <option value="$gt">is greater than</option>
                          <option value="$gte">
                            is greater than or equal to
                          </option>
                          <option value="$lt">is less than</option>
                          <option value="$lte">is less than or equal to</option>
                          <option value="$in">is in the list</option>
                          <option value="$nin">is not in the list</option>
                          <option value="$exists">exists</option>
                          <option value="$notExists">does not exist</option>
                        </>
                      ) : attribute.datatype === "number" ? (
                        <>
                          <option value="$eq">is equal to</option>
                          <option value="$ne">is not equal to</option>
                          <option value="$gt">is greater than</option>
                          <option value="$gte">
                            is greater than or equal to
                          </option>
                          <option value="$lt">is less than</option>
                          <option value="$lte">is less than or equal to</option>
                          <option value="$in">is in the list</option>
                          <option value="$nin">is not in the list</option>
                          <option value="$exists">exists</option>
                          <option value="$notExists">does not exist</option>
                        </>
                      ) : (
                        ""
                      )}
                    </select>
                  </div>
                  {["$exists", "$notExists", "$true", "$false"].includes(
                    operator
                  ) ? (
                    ""
                  ) : ["$in", "$nin"].includes(operator) ? (
                    <Field
                      textarea
                      placeholder="comma separated"
                      value={value}
                      onChange={onChange}
                      name="value"
                      containerClassName="col-sm-12 col-md mb-2"
                    />
                  ) : attribute.enum.length ? (
                    <Field
                      options={attribute.enum}
                      value={value}
                      onChange={onChange}
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
                      containerClassName="col-sm-12 col-md mb-2"
                    />
                  ) : attribute.datatype === "string" ? (
                    <Field
                      value={value}
                      onChange={onChange}
                      name="value"
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
