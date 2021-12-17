import React, { useContext } from "react";
import { useState, useEffect } from "react";
import {
  condToJson,
  jsonToConds,
  useAttributeMap,
} from "../../services/features";
import Field from "../Forms/Field";
import { UserContext } from "../ProtectedPage";

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

  const { settings } = useContext(UserContext);

  const [hasAttributes, attributeTypes] = useAttributeMap();

  useEffect(() => {
    if (advanced) return;
    setValue(condToJson(conds));
  }, [advanced, conds]);

  useEffect(() => {
    props.onChange(value);
    setSimpleAllowed(jsonToConds(value) !== null);
  }, [value]);

  if (advanced || !hasAttributes || !simpleAllowed) {
    return (
      <div className="mb-3">
        <Field
          label="Conditions"
          containerClassName="mb-0"
          textarea
          minRows={1}
          maxRows={12}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          helpText="JSON format using MongoDB query syntax"
        />
        {simpleAllowed && hasAttributes && (
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
        <label>Conditions</label>
      </div>
      {conds.length > 0 && (
        <ul className="mb-2 pl-4">
          {conds.map(({ field, operator, value }, i) => {
            const type = attributeTypes[field];
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

                      const newType = attributeTypes[value];
                      if (newType !== type) {
                        if (newType === "boolean") {
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
                    {type === "boolean" && (
                      <>
                        <option value="$true">is true</option>
                        <option value="$false">is false</option>
                      </>
                    )}
                    {(type === "number" || type === "string") && (
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
                    )}
                    {type === "string" && (
                      <option value="$regex">matches regex</option>
                    )}
                    {(type === "number[]" || type === "string[]") && (
                      <>
                        <option value="$eq">contains</option>
                        <option value="$ne">does not contain</option>
                      </>
                    )}
                    <option value="$exists">exists</option>
                    <option value="$notExists">does not exist</option>
                  </select>
                  {!["$exists", "$notExists", "$true", "$false"].includes(
                    operator
                  ) &&
                    type !== "boolean" && (
                      <input
                        type={
                          type === "number" || type === "number[]"
                            ? "number"
                            : "text"
                        }
                        step="any"
                        value={value}
                        onChange={onChange}
                        name="value"
                        className="form-control"
                      />
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
      )}
      <button
        className="btn btn-outline-primary"
        type="button"
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
        add condition
      </button>
      {conds.length > 0 && (
        <button
          className="btn btn-link"
          onClick={(e) => {
            e.preventDefault();
            setAdvanced(true);
          }}
          type="button"
        >
          switch to advanced mode
        </button>
      )}
    </div>
  );
}
