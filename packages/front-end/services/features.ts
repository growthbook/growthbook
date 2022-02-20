import { useEffect, useMemo } from "react";
import {
  SDKAttributeSchema,
  SDKAttributeType,
} from "back-end/types/organization";
import {
  ExperimentRule,
  FeatureInterface,
  FeatureRule,
  FeatureValueType,
} from "back-end/types/feature";
import stringify from "json-stringify-pretty-compact";
import uniq from "lodash/uniq";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useUser from "../hooks/useUser";
import { useAuth } from "./auth";
import useApi from "../hooks/useApi";
import { FeatureUsageRecords } from "../../back-end/types/realtime";

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

export function useAttributeSchema() {
  const { settings, update } = useUser();
  const { apiCall } = useAuth();

  useEffect(() => {
    if (!settings?.attributeSchema) {
      apiCall(`/organization`, {
        method: "PUT",
        body: JSON.stringify({
          settings: {
            attributeSchema: [
              { property: "id", datatype: "string", hashAttribute: true },
              { property: "deviceId", datatype: "string", hashAttribute: true },
              { property: "company", datatype: "string", hashAttribute: true },
              { property: "loggedIn", datatype: "boolean" },
              { property: "employee", datatype: "boolean" },
              { property: "country", datatype: "string" },
              { property: "browser", datatype: "string" },
              { property: "url", datatype: "string" },
            ],
          },
        }),
      }).then(() => {
        update();
      });
    }
  }, [settings?.attributeSchema]);

  return settings?.attributeSchema || [];
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

export function jsonToConds(
  json: string,
  attributes?: Map<string, AttributeData>
): null | Condition[] {
  if (!json || json === "{}") return [];
  // Advanced use case where we can't use the simple editor
  if (json.match(/\$(or|nor|elemMatch|all|type|size)/)) return null;

  try {
    const parsed = JSON.parse(json);
    if (parsed["$not"]) return null;

    const conds: Condition[] = [];
    let valid = true;

    Object.keys(parsed).forEach((field) => {
      if (attributes && !attributes.has(field)) {
        valid = false;
        return;
      }

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
  const attributeSchema = useAttributeSchema();

  return useMemo(() => {
    if (!attributeSchema.length) {
      return new Map();
    }

    const map = new Map<string, AttributeData>();
    attributeSchema.forEach((schema) => {
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
  }, [attributeSchema]);
}

export function getExperimentDefinitionFromFeature(
  feature: FeatureInterface,
  expRule: ExperimentRule
) {
  const trackingKey = expRule?.trackingKey || feature.id;
  if (!trackingKey) {
    return null;
  }

  const totalPercent = expRule.values.reduce((sum, w) => sum + w.weight, 0);

  const expDefinition: Partial<ExperimentInterfaceStringDates> = {
    trackingKey: trackingKey,
    name: trackingKey + " experiment",
    hypothesis: expRule.description || "",
    description: `Experiment analysis for the feature [**${feature.id}**](/features/${feature.id})`,
    variations: expRule.values.map((v, i) => {
      let name = i ? `Variation ${i}` : "Control";
      if (feature.valueType === "boolean") {
        name = v.value === "true" ? "On" : "Off";
      }
      return {
        name,
        screenshots: [],
        description: v.value,
      };
    }),
    phases: [
      {
        coverage: totalPercent,
        variationWeights: expRule.values.map((v) =>
          totalPercent > 0 ? v.weight / totalPercent : 1 / expRule.values.length
        ),
        phase: "main",
        reason: "",
        dateStarted: new Date().toISOString(),
      },
    ],
  };
  return expDefinition;
}

export function useRealtimeData(
  features: FeatureInterface[] = [],
  mock = false,
  update = false
): { usage: FeatureUsageRecords; usageDomain: [number, number] } {
  const { data, mutate } = useApi<{
    usage: FeatureUsageRecords;
  }>(`/usage/features`);

  // Mock data
  const usage = useMemo(() => {
    if (!mock || !features) {
      return data?.usage || {};
    }
    const usage: FeatureUsageRecords = {};
    features.forEach((f) => {
      usage[f.id] = { realtime: [] };
      const usedRatio = Math.random();
      const volumeRatio = Math.random();
      for (let i = 0; i < 30; i++) {
        usage[f.id].realtime.push({
          used: Math.floor(Math.random() * 1000 * usedRatio * volumeRatio),
          skipped: Math.floor(
            Math.random() * 1000 * (1 - usedRatio) * volumeRatio
          ),
        });
      }
    });
    return usage;
  }, [features, mock, data?.usage]);

  // Update usage data every 10 seconds
  useEffect(() => {
    if (!update) return;
    let timer = 0;
    const cb = async () => {
      await mutate();
      timer = window.setTimeout(cb, 10000);
    };
    timer = window.setTimeout(cb, 10000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [update]);

  const max = useMemo(() => {
    return Math.max(
      1,
      ...Object.values(usage).map((d) => {
        return Math.max(1, ...d.realtime.map((u) => u.used + u.skipped));
      })
    );
  }, [usage]);

  return { usage, usageDomain: [0, max] };
}
