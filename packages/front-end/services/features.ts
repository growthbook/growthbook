import { useMemo } from "react";
import {
  SDKAttributeSchema,
  SDKAttributeType,
} from "back-end/types/organization";
import { FeatureRule, FeatureValueType } from "back-end/types/feature";
import stringify from "json-stringify-pretty-compact";
import useOrgSettings from "../hooks/useOrgSettings";
import uniq from "lodash/uniq";

export interface Condition {
  field: string;
  operator: string;
  value: string;
}

export interface AttributeData {
  attribute: string;
  datatype: "boolean" | "number" | "string";
  array: boolean;
  identifier: boolean;
  enum: string[];
}

export function validateFeatureRule(
  rule: FeatureRule,
  valueType: FeatureValueType
) {
  if (rule.condition) {
    try {
      const res = JSON.parse(rule.condition);
      if (!res || typeof res !== "object") {
        throw new Error("Condition is invalid");
      }
    } catch (e) {
      throw new Error("Condition is invalid: " + e.message);
    }
  }
  if (rule.type === "force") {
    isValidValue(valueType, rule.value, "Forced value");
  } else if (rule.type === "experiment") {
    const ruleValues = rule.values;
    if (!ruleValues || !ruleValues.length) {
      throw new Error("Must set at least one value");
    }
    let totalWeight = 0;
    ruleValues.forEach((val, i) => {
      if (val.weight < 0) throw new Error("Percents cannot be negative");
      totalWeight += val.weight;
      isValidValue(valueType, val.value, "Value #" + (i + 1));
    });
    if (totalWeight > 1) {
      throw new Error(
        `Sum of weights cannot be greater than 1 (currently equals ${totalWeight})`
      );
    }
    if (uniq(ruleValues.map((v) => v.value)).length !== ruleValues.length) {
      throw new Error(`All variations must be unique`);
    }
  } else {
    isValidValue(valueType, rule.value, "Rollout value");

    if (rule.type === "rollout" && (rule.coverage < 0 || rule.coverage > 1)) {
      throw new Error("Rollout percent must be between 0 and 1");
    }
  }
}

export function getDefaultValue(valueType: FeatureValueType): string {
  if (valueType === "boolean") {
    return "true";
  }
  if (valueType === "number") {
    return "1";
  }
  if (valueType === "string") {
    return "foo";
  }
  if (valueType === "json") {
    return "{}";
  }
  return "";
}
export function getDefaultVariationValue(defaultValue: string) {
  const map: Record<string, string> = {
    true: "false",
    false: "true",
    "1": "0",
    "0": "1",
    foo: "bar",
    bar: "foo",
  };
  return defaultValue in map ? map[defaultValue] : defaultValue;
}

export function getDefaultRuleValue({
  defaultValue,
  attributeSchema,
  ruleType,
}: {
  defaultValue: string;
  attributeSchema?: SDKAttributeSchema;
  ruleType: string;
}): FeatureRule {
  const hashAttributes = attributeSchema
    .filter((a) => a.hashAttribute)
    .map((a) => a.property);
  const hashAttribute = hashAttributes.includes("id")
    ? "id"
    : hashAttributes[0] || "id";

  const value = getDefaultVariationValue(defaultValue);

  if (ruleType === "rollout") {
    return {
      type: "rollout",
      description: "",
      id: "",
      value,
      coverage: 0.5,
      condition: "",
      enabled: true,
      hashAttribute,
    };
  }
  if (ruleType === "experiment") {
    return {
      type: "experiment",
      description: "",
      id: "",
      condition: "",
      enabled: true,
      hashAttribute,
      trackingKey: "",
      values: [
        {
          value: defaultValue,
          weight: 0.5,
        },
        {
          value: value,
          weight: 0.5,
        },
      ],
    };
  }

  const firstAttr = attributeSchema?.[0];
  const condition = firstAttr
    ? JSON.stringify({
        [firstAttr.property]: firstAttr.datatype === "boolean" ? "true" : "",
      })
    : "";

  return {
    type: "force",
    description: "",
    id: "",
    value,
    enabled: true,
    condition,
  };
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

function parseValue(value: string, type?: "string" | "number" | "boolean") {
  if (type === "number") return parseFloat(value) || 0;
  if (type === "boolean") return value === "false" ? false : true;
  return value;
}

export function condToJson(
  conds: Condition[],
  attributes: Map<string, AttributeData>
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
        .map((x) => parseValue(x, attributes.get(field)?.datatype));
    } else {
      obj[field][operator] = parseValue(value, attributes.get(field)?.datatype);
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

function getAttributeDataType(type: SDKAttributeType) {
  if (type === "boolean" || type === "number" || type === "string") return type;

  if (type === "enum" || type === "string[]") return "string";

  return "number";
}

export function useAttributeMap(): Map<string, AttributeData> {
  const settings = useOrgSettings();

  return useMemo(() => {
    if (!settings?.attributeSchema?.length) {
      return new Map();
    }

    const map = new Map<string, AttributeData>();
    settings.attributeSchema.forEach((schema) => {
      map.set(schema.property, {
        attribute: schema.property,
        datatype: getAttributeDataType(schema.datatype),
        array: !!schema.datatype.match(/\[\]$/),
        enum:
          schema.datatype === "enum"
            ? schema.enum.split(",").map((x) => x.trim())
            : [],
        identifier: !!schema.hashAttribute,
      });
    });

    return map;
  }, [settings?.attributeSchema]);
}
