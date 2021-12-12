import { useState, useEffect } from "react";
import Field from "../Forms/Field";

interface Props {
  defaultValue: string;
  onChange: (value: string) => void;
}

interface Condition {
  field: string;
  operator: string;
  value: string;
}

function jsonToConds(json: string): null | Condition[] {
  if (!json) return [];
  // Advanced use case where we can't use the simple editor
  if (json.match(/\$(or|nor|elemMatch|all|type|size)/)) return null;

  try {
    const parsed = JSON.parse(json);
    if (parsed["$not"]) return null;

    const conds: Condition[] = [];
    let valid = true;

    Object.keys(parsed).forEach((field) => {
      const value = parsed[field];
      if (Array.isArray(value)) {
        valid = false;
        return;
      }

      if (!value || typeof value !== "object") {
        return conds.push({
          field,
          operator: "$eq",
          value: JSON.stringify(value).replace(/(^"|"$)/g, ""),
        });
      }
      Object.keys(value).forEach((operator) => {
        const v = value[operator];

        if (operator === "$in" || operator === "$nin") {
          return conds.push({
            field,
            operator,
            value: v.join(","),
          });
        }

        if (Array.isArray(v) || (v && typeof v === "object")) {
          valid = false;
          return;
        }

        if (
          [
            "$eq",
            "$ne",
            "$gt",
            "$gte",
            "$lt",
            "$lte",
            "$regex",
            "$exists",
          ].includes(operator)
        ) {
          return conds.push({
            field,
            operator,
            value: JSON.stringify(v).replace(/(^"|"$)/g, ""),
          });
        }

        if (operator === "$not") {
          if (
            typeof v === "object" &&
            Object.keys(v).length === 1 &&
            "$regex" in v
          ) {
            return conds.push({
              field,
              operator: "$notRegex",
              value: JSON.stringify(v["$regex"]).replace(/(^"|"$)/g, ""),
            });
          }
        }

        valid = false;
      });
    });

    if (!valid) return null;
    return conds;
  } catch (e) {
    return null;
  }
}

function condToJson(conds: Condition[]) {
  const obj = {};
  conds.forEach(({ field, operator, value }) => {
    obj[field] = obj[field] || {};
    if (operator === "$notRegex") {
      obj[field]["$not"] = { $regex: value };
    } else if (operator === "$in" || operator === "$nin") {
      obj[field][operator] = value.split(",");
    } else {
      obj[field][operator] = value;
    }
  });

  // Simplify {$eg: ""} rules
  Object.keys(obj).forEach((key) => {
    if (Object.keys(obj[key]).length === 1 && "$eq" in obj[key]) {
      obj[key] = obj[key]["$eq"];
    }
  });

  return JSON.stringify(obj, null, 2);
}

export default function ConditionInput(props: Props) {
  const [advanced, setAdvanced] = useState(
    () => jsonToConds(props.defaultValue) === null
  );
  const [value, setValue] = useState(props.defaultValue);
  const [conds, setConds] = useState(() => jsonToConds(props.defaultValue));

  useEffect(() => {
    if (advanced) return;
    setValue(condToJson(conds));
  }, [advanced, conds]);

  useEffect(() => {
    props.onChange(value);
  }, [value]);

  if (advanced) {
    return (
      <div>
        <Field
          label="JSON Condition"
          textarea
          minRows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <small>
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
        </small>
      </div>
    );
  }

  return <div>TODO: Simple Editor</div>;
}
