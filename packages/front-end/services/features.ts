import { useEffect, useMemo } from "react";
import {
  NamespaceUsage,
  SDKAttributeSchema,
  SDKAttributeType,
} from "back-end/types/organization";
import {
  ExperimentRule,
  ExperimentValue,
  FeatureInterface,
  FeatureRule,
  FeatureValueType,
  ForceRule,
  RolloutRule,
} from "back-end/types/feature";
import stringify from "json-stringify-pretty-compact";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FeatureUsageRecords } from "back-end/types/realtime";
import dJSON from "dirty-json";
import cloneDeep from "lodash/cloneDeep";
import { useLocalStorage } from "../hooks/useLocalStorage";
import useOrgSettings from "../hooks/useOrgSettings";
import useApi from "../hooks/useApi";
import { useDefinitions } from "./DefinitionsContext";

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
  archived: boolean;
}

export function validateFeatureValue(
  type: FeatureValueType,
  value: string,
  label: string
): string {
  const prefix = label ? label + ": " : "";
  if (type === "boolean") {
    if (!["true", "false"].includes(value)) {
      return value ? "true" : "false";
    }
  } else if (type === "number") {
    if (!value.match(/^-?[0-9]+(\.[0-9]+)?$/)) {
      throw new Error(prefix + "Must be a valid number");
    }
  } else if (type === "json") {
    try {
      JSON.parse(value);
    } catch (e) {
      // If the JSON is invalid, try to parse it with 'dirty-json' instead
      try {
        return stringify(dJSON.parse(value));
      } catch (e) {
        throw new Error(prefix + e.message);
      }
    }
  }

  return value;
}

export function useEnvironmentState() {
  const [state, setState] = useLocalStorage("currentEnvironment", "dev");

  const environments = useEnvironments();

  if (!environments.map((e) => e.id).includes(state)) {
    return [environments[0]?.id || "production", setState] as const;
  }

  return [state, setState] as const;
}

export function useEnvironments() {
  const { environments } = useOrgSettings();

  if (!environments || !environments.length) {
    return [
      {
        id: "dev",
        description: "",
        toggleOnList: true,
      },
      {
        id: "production",
        description: "",
        toggleOnList: true,
      },
    ];
  }

  return environments;
}
export function getRules(feature: FeatureInterface, environment: string) {
  if (feature.draft?.active && feature.draft.rules?.[environment]) {
    return feature.draft.rules[environment];
  }
  return feature?.environmentSettings?.[environment]?.rules ?? [];
}
export function getFeatureDefaultValue(feature: FeatureInterface) {
  if (feature.draft?.active && "defaultValue" in feature.draft) {
    return feature.draft.defaultValue;
  }
  return feature.defaultValue;
}
export function roundVariationWeight(num: number): number {
  return Math.round(num * 1000) / 1000;
}
export function getTotalVariationWeight(weights: number[]): number {
  return roundVariationWeight(weights.reduce((sum, w) => sum + w, 0));
}

export function getVariationDefaultName(
  val: ExperimentValue,
  type: FeatureValueType
) {
  if (val.name) {
    return val.name;
  }

  if (type === "boolean") {
    return val.value === "true" ? "On" : "Off";
  }

  if (type === "json") {
    return "";
  }

  return val.value;
}

type NamespaceGaps = { start: number; end: number }[];
export function findGaps(
  namespaces: NamespaceUsage,
  namespace: string,
  featureId: string = "",
  trackingKey: string = ""
): NamespaceGaps {
  const experiments = namespaces?.[namespace] || [];

  // Sort by range start, ascending
  const ranges = [
    ...experiments.filter(
      // Exclude the current feature/experiment
      (e) => e.featureId !== featureId || e.trackingKey !== trackingKey
    ),
    { start: 1, end: 1 },
  ];
  ranges.sort((a, b) => a.start - b.start);

  // Look for gaps between ranges
  const gaps: NamespaceGaps = [];
  let lastEnd = 0;
  ranges.forEach(({ start, end }) => {
    if (start > lastEnd) {
      gaps.push({
        start: lastEnd,
        end: start,
      });
    }
    lastEnd = Math.max(lastEnd, end);
  });

  return gaps;
}

export function useFeaturesList(withProject = true) {
  const { project } = useDefinitions();

  const url = withProject ? `/feature?project=${project || ""}` : "/feature";

  const { data, error, mutate } = useApi<{
    features: FeatureInterface[];
  }>(url);

  return {
    features: data?.features || [],
    loading: !data,
    error,
    mutate,
  };
}

export function getVariationColor(i: number) {
  const colors = [
    "#8f66dc",
    "#e5a6f3",
    "#38aecc",
    "#f5dd90",
    "#3383ec",
    "#80c17b",
    "#79c4e0",
    "#f87a7a",
    "#6cc160",
  ];
  return colors[i % colors.length];
}

export function useAttributeSchema(showArchived = false) {
  const attributeSchema = useOrgSettings().attributeSchema || [];
  return useMemo(() => {
    if (!showArchived) {
      return attributeSchema.filter((s) => !s.archived);
    }
    return attributeSchema;
  }, [attributeSchema, showArchived]);
}

export function validateFeatureRule(
  rule: FeatureRule,
  valueType: FeatureValueType
): null | FeatureRule {
  let hasChanges = false;
  const ruleCopy = cloneDeep(rule);
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
    const newValue = validateFeatureValue(
      valueType,
      rule.value,
      "Value to Force"
    );
    if (newValue !== rule.value) {
      hasChanges = true;
      (ruleCopy as ForceRule).value = newValue;
    }
  } else if (rule.type === "experiment") {
    const ruleValues = rule.values;
    if (!ruleValues || !ruleValues.length) {
      throw new Error("Must set at least one value");
    }
    let totalWeight = 0;
    ruleValues.forEach((val, i) => {
      if (val.weight < 0)
        throw new Error("Variation weights cannot be negative");
      val.weight = roundVariationWeight(val.weight);
      totalWeight += val.weight;
      const newValue = validateFeatureValue(
        valueType,
        val.value,
        "Variation #" + i
      );
      if (newValue !== val.value) {
        hasChanges = true;
        (ruleCopy as ExperimentRule).values[i].value = newValue;
      }
    });
    // Without this rounding here, JS floating point messes up simple addition.
    totalWeight = roundVariationWeight(totalWeight);

    if (totalWeight > 1) {
      throw new Error(
        `Sum of weights cannot be greater than 1 (currently equals ${totalWeight})`
      );
    }
  } else {
    const newValue = validateFeatureValue(
      valueType,
      rule.value,
      "Value to Rollout"
    );
    if (newValue !== rule.value) {
      hasChanges = true;
      (ruleCopy as RolloutRule).value = newValue;
    }

    if (rule.type === "rollout" && (rule.coverage < 0 || rule.coverage > 1)) {
      throw new Error("Rollout percent must be between 0 and 1");
    }
  }

  return hasChanges ? ruleCopy : null;
}

export function getEnabledEnvironments(feature: FeatureInterface) {
  return Object.keys(feature.environmentSettings ?? {}).filter((env) => {
    return !!feature.environmentSettings?.[env]?.enabled;
  });
}

export function getAffectedEnvs(
  feature: FeatureInterface,
  changedEnvs: string[]
): string[] {
  const settings = feature.environmentSettings;
  if (!settings) return [];

  return changedEnvs.filter((e) => settings?.[e]?.enabled);
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
      scheduleRules: [
        {
          enabled: true,
          timestamp: null,
        },
        {
          enabled: false,
          timestamp: null,
        },
      ],
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
          name: "",
        },
        {
          value: value,
          weight: 0.5,
          name: "",
        },
      ],
      coverage: 1,
      namespace: {
        enabled: false,
        name: "",
        range: [0, 0.5],
      },
      scheduleRules: [
        {
          enabled: true,
          timestamp: null,
        },
        {
          enabled: false,
          timestamp: null,
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
    scheduleRules: [
      {
        enabled: true,
        timestamp: null,
      },
      {
        enabled: false,
        timestamp: null,
      },
    ],
  };
}

export function jsonToConds(
  json: string,
  attributes?: Map<string, AttributeData>
): null | Condition[] {
  if (!json || json === "{}") return [];
  // Advanced use case where we can't use the simple editor
  if (json.match(/\$(or|nor|all|type)/)) return null;

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

      if (typeof value !== "object") {
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
          value: value + "",
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

        if (operator === "$elemMatch") {
          if (typeof v === "object" && Object.keys(v).length === 1) {
            if ("$eq" in v && typeof v["$eq"] !== "object") {
              return conds.push({
                field,
                operator: "$includes",
                value: v["$eq"] + "",
              });
            }
          }
          valid = false;
          return;
        }

        if (operator === "$not") {
          if (typeof v === "object" && Object.keys(v).length === 1) {
            if ("$regex" in v && typeof v["$regex"] === "string") {
              return conds.push({
                field,
                operator: "$notRegex",
                value: v["$regex"],
              });
            }
            if ("$elemMatch" in v) {
              const m = v["$elemMatch"];
              if (typeof m === "object" && Object.keys(m).length === 1) {
                if ("$eq" in m && typeof m["$eq"] !== "object") {
                  return conds.push({
                    field,
                    operator: "$notIncludes",
                    value: m["$eq"] + "",
                  });
                }
              }
            }
          }
        }

        if (operator === "$size") {
          if (v === 0) {
            return conds.push({
              field,
              operator: "$empty",
              value: "",
            });
          }
          if (typeof v === "object" && Object.keys(v).length === 1) {
            if ("$gt" in v && v["$gt"] === 0) {
              return conds.push({
                field,
                operator: "$notEmpty",
                value: "",
              });
            }
          }
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
          ) &&
          typeof v !== "object"
        ) {
          return conds.push({
            field,
            operator,
            value: v + "",
          });
        }

        if (
          (operator === "$inGroup" || operator === "$notInGroup") &&
          typeof v === "string"
        ) {
          return conds.push({
            field,
            operator,
            value: v,
          });
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
    } else if (operator === "$exists") {
      obj[field]["$exists"] = true;
    } else if (operator === "$true") {
      obj[field]["$eq"] = true;
    } else if (operator === "$false") {
      obj[field]["$eq"] = false;
    } else if (operator === "$includes") {
      obj[field]["$elemMatch"] = {
        $eq: parseValue(value, attributes.get(field)?.datatype),
      };
    } else if (operator === "$notIncludes") {
      obj[field]["$not"] = {
        $elemMatch: { $eq: parseValue(value, attributes.get(field)?.datatype) },
      };
    } else if (operator === "$empty") {
      obj[field]["$size"] = 0;
    } else if (operator === "$notEmpty") {
      obj[field]["$size"] = { $gt: 0 };
    } else if (operator === "$in" || operator === "$nin") {
      obj[field][operator] = value
        .split(",")
        .map((x) => x.trim())
        .map((x) => parseValue(x, attributes.get(field)?.datatype));
    } else if (operator === "$inGroup" || operator === "$notInGroup") {
      obj[field][operator] = value;
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
  const attributeSchema = useAttributeSchema(true);

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
        archived: !!schema.archived,
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

  const expDefinition: Partial<ExperimentInterfaceStringDates> = {
    trackingKey: trackingKey,
    name: trackingKey + " experiment",
    hypothesis: expRule.description || "",
    description: `Experiment analysis for the feature [**${feature.id}**](/features/${feature.id})`,
    variations: expRule.values.map((v, i) => {
      let name = i ? `Variation ${i}` : "Control";
      if (v?.name) {
        name = v.name;
      } else if (feature.valueType === "boolean") {
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
        coverage: expRule.coverage || 1,
        variationWeights: expRule.values.map((v) => v.weight),
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

export function getDefaultOperator(attribute: AttributeData) {
  if (attribute.datatype === "boolean") {
    return "$true";
  } else if (attribute.array) {
    return "$includes";
  }
  return "$eq";
}

export function genDuplicatedKey({ id }: FeatureInterface) {
  try {
    // Take the '_4' out of 'feature_a_4'
    const numSuffix = id.match(/_[\d]+$/)?.[0];
    // Store 'feature_a' from 'feature_a_4'
    const keyRoot = numSuffix ? id.substr(0, id.length - numSuffix.length) : id;
    // Parse the 4 (number) out of '_4' (string)
    const num = (numSuffix ? parseInt(numSuffix.match(/[\d]+/)[0]) : 0) + 1;

    return `${keyRoot}_${num}`;
  } catch (e) {
    // we failed, let the user name the key
    return "";
  }
}
