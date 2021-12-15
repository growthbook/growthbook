import { useContext, useMemo } from "react";
import { SDKAttributeType } from "back-end/types/organization";
import { UserContext } from "../components/ProtectedPage";

export interface Condition {
  field: string;
  operator: string;
  value: string;
}

export function jsonToConds(json: string): null | Condition[] {
  if (!json || json === "{}") return [];
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
        if (value === true || value === false) {
          return conds.push({
            field,
            operator: value ? "$true" : "$false",
            value: "",
          });
        }

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

        if (operator === "$exists") {
          return conds.push({
            field,
            operator: v ? "$exists" : "$notExists",
            value: "",
          });
        }
        if (operator === "$eq" && (v === true || v === false)) {
          return conds.push({
            field,
            operator: v ? "$true" : "$false",
            value: "",
          });
        }
        if (operator === "$ne" && (v === true || v === false)) {
          return conds.push({
            field,
            operator: v ? "$false" : "$true",
            value: "",
          });
        }

        if (
          ["$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$regex"].includes(
            operator
          )
        ) {
          return conds.push({
            field,
            operator,
            value: JSON.stringify(v).replace(/(^"|"$)/g, ""),
          });
        }

        if (operator === "$not") {
          if (typeof v === "object" && Object.keys(v).length === 1) {
            if ("$regex" in v) {
              return conds.push({
                field,
                operator: "$notRegex",
                value: JSON.stringify(v["$regex"]).replace(/(^"|"$)/g, ""),
              });
            }
          }
        }

        valid = false;
      });
    });

    console.log(conds, valid);

    if (!valid) return null;
    return conds;
  } catch (e) {
    return null;
  }
}

export function condToJson(conds: Condition[]) {
  const obj = {};
  conds.forEach(({ field, operator, value }) => {
    obj[field] = obj[field] || {};
    if (operator === "$notRegex") {
      obj[field]["$not"] = { $regex: value };
    } else if (operator === "$notExists") {
      obj[field]["$exists"] = false;
    } else if (operator === "$true") {
      obj[field]["$eq"] = true;
    } else if (operator === "$false") {
      obj[field]["$eq"] = false;
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

export function useAttributeMap() {
  const { settings } = useContext(UserContext);

  return [
    settings?.attributeSchema?.length > 0,
    useMemo(() => {
      if (!settings?.attributeSchema) return {};

      const map: Record<string, SDKAttributeType> = {};
      settings.attributeSchema.forEach(({ property, datatype }) => {
        map[property] = datatype;
      });
      return map;
    }, [settings?.attributeSchema]),
  ];
}
