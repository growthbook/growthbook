import { useContext, useMemo } from "react";
import { SDKAttributeType } from "back-end/types/organization";
import { UserContext } from "../components/ProtectedPage";
import { FeatureValueType } from "back-end/types/feature";
import stringify from "json-stringify-pretty-compact";

export interface Condition {
  field: string;
  operator: string;
  value: string;
}

export function isValidValue(
  type: FeatureValueType,
  value: string,
  label: string
) {
  try {
    if (type === "boolean") {
      if (value !== "true" && value !== "false") {
        throw new Error(
          `Value must be either true or false. "${value}" given instead.`
        );
      }
    } else if (type === "number") {
      const parsed = parseFloat(value);
      if (isNaN(parsed)) throw new Error(`Invalid number: "${value}"`);
    } else if (type === "json") {
      JSON.parse(value);
    }
  } catch (e) {
    throw new Error(label + ": " + e.message);
  }
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
          value: stringify(value).replace(/(^"|"$)/g, ""),
        });
      }
      Object.keys(value).forEach((operator) => {
        const v = value[operator];

        if (operator === "$in" || operator === "$nin") {
          return conds.push({
            field,
            operator,
            value: v.join(", "),
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
            value: stringify(v).replace(/(^"|"$)/g, ""),
          });
        }

        if (operator === "$not") {
          if (typeof v === "object" && Object.keys(v).length === 1) {
            if ("$regex" in v) {
              return conds.push({
                field,
                operator: "$notRegex",
                value: stringify(v["$regex"]).replace(/(^"|"$)/g, ""),
              });
            }
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

function parseValue(value: string, type?: SDKAttributeType) {
  if (type === "number" || type === "number[]") return parseFloat(value) || 0;
  if (type === "boolean") return value === "false" ? false : true;
  return value;
}

export function condToJson(
  conds: Condition[],
  attributeTypes: Record<string, SDKAttributeType>
) {
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
      obj[field][operator] = value
        .split(",")
        .map((x) => x.trim())
        .map((x) => parseValue(x, attributeTypes[field]));
    } else {
      obj[field][operator] = parseValue(value, attributeTypes[field]);
    }
  });

  // Simplify {$eg: ""} rules
  Object.keys(obj).forEach((key) => {
    if (Object.keys(obj[key]).length === 1 && "$eq" in obj[key]) {
      obj[key] = obj[key]["$eq"];
    }
  });

  return stringify(obj);
}

export function useAttributeMap(): [boolean, Record<string, SDKAttributeType>] {
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
