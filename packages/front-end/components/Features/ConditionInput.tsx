import React from "react";
import { useState, useEffect } from "react";
import useOrgSettings from "../../hooks/useOrgSettings";
import {
  condToJson,
  jsonToConds,
  useAttributeMap,
} from "../../services/features";
import Field from "../Forms/Field";

interface Props {
  defaultValue: string;
  onChange: (value: string) => void;
}

export default function ConditionInput(props: Props) {
  const [advanced, setAdvanced] = useState(
    () => jsonToConds(props.defaultValue) === null
  );
  const [simpleAllowed, setSimpleAllowed] = useState(false);
  const [value, setValue] = useState(props.defaultValue);
  const [conds, setConds] = useState(() => jsonToConds(props.defaultValue));

  const settings = useOrgSettings();

  const attributes = useAttributeMap();

  useEffect(() => {
    if (advanced) return;
    setValue(condToJson(conds, attributes));
  }, [advanced, conds]);

  useEffect(() => {
    props.onChange(value);
    setSimpleAllowed(jsonToConds(value) !== null);
  }, [value]);

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
              const newConds = jsonToConds(value);
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

  return (
    <div className="mb-3">
      <div>
        <label>Targeting Conditions</label>
      </div>
      {conds.length > 0 ? (
        <>
          <ul className="mb-2 pl-4">
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
                <li key={i} className="mb-1">
                  <div className="form-inline">
                    {i > 0 && <span className="mr-1">AND</span>}
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
                      className="form-control mr-1"
                    >
                      {settings.attributeSchema.map((s) => (
                        <option key={s.property}>{s.property}</option>
                      ))}
                    </select>
                    <select
                      value={operator}
                      name="operator"
                      onChange={onChange}
                      className="form-control mr-1"
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
                          <option value="$eq">contains</option>
                          <option value="$ne">does not contain</option>
                          <option value="$exists">exists</option>
                          <option value="$notExists">does not exist</option>
                        </>
                      ) : attribute.enum ? (
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
                          <option value="$gt">is greater than</option>
                          <option value="$gte">
                            is greater than or equal to
                          </option>
                          <option value="$lt">is less than</option>
                          <option value="$lte">is less than or equal to</option>
                          <option value="$in">is in the list</option>
                          <option value="$nin">is not in the list</option>
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
                        </>
                      ) : (
                        ""
                      )}
                    </select>
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
                      />
                    ) : attribute.enum.length ? (
                      <Field
                        options={attribute.enum}
                        value={value}
                        onChange={onChange}
                        name="value"
                        initialOption="Choose One..."
                      />
                    ) : attribute.datatype === "number" ? (
                      <Field
                        type="number"
                        step="any"
                        value={value}
                        onChange={onChange}
                        name="value"
                      />
                    ) : attribute.datatype === "string" ? (
                      <Field value={value} onChange={onChange} name="value" />
                    ) : (
                      ""
                    )}
                    <button
                      className="btn btn-link text-danger"
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        console.log("Click delete");
                        const newConds = [...conds];
                        newConds.splice(i, 1);
                        setConds(newConds);
                      }}
                    >
                      remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="d-flex align-items-center">
            <a
              className="mr-3"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                const prop = settings?.attributeSchema?.[0];
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
              advanced mode
            </a>
          </div>
        </>
      ) : (
        <>
          <div>
            <em className="text-muted ml-2">Applied to everyone.</em>{" "}
            <a
              href="#"
              className="ml-3"
              onClick={(e) => {
                e.preventDefault();
                const prop = settings?.attributeSchema?.[0];
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
              Add targeting condition
            </a>
          </div>
        </>
      )}
    </div>
  );
}
