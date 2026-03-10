import { ProjectInterface } from "shared/types/project";
import { Environment } from "shared/types/organization";
import {
  FeatureInterface,
  FeatureRule,
  FeatureValueType,
} from "shared/types/feature";
import { ConditionInterface } from "@growthbook/growthbook-react";
import { uniqBy } from "lodash";
import { ApiCallType } from "@/services/auth";

// Various utilities to help migrate from another service to GrowthBook

// region LD

export type LDListProjectsResponse = {
  items: {
    key: string;
    name: string;
  }[];
};

/**
 * Transform responses from GET {{ base_url }}/api/v2/projects
 * @param data
 */
export const transformLDProjectsToGBProject = (
  data: LDListProjectsResponse,
): Pick<ProjectInterface, "id" | "name" | "description">[] => {
  return uniqBy(
    data.items.map(({ key, name }) => ({
      id: key,
      name: name,
      description: "",
    })),
    "id",
  );
};

export type LDListEnvironmentsResponse = {
  items: {
    key: string;
    name: string;
  }[];
};

/**
 * Transforms responses from GET {{ base_url }}/api/v2/projects/{{ project_key }}/environments
 * @param data
 */
export const transformLDEnvironmentsToGBEnvironment = (
  data: LDListEnvironmentsResponse,
): Environment[] => {
  return uniqBy(
    data.items.map(({ key, name }) => ({
      id: key,
      description: name,
    })),
    "id",
  );
};

export type LDOperator =
  | "in"
  | "endsWith"
  | "startsWith"
  | "matches"
  | "contains"
  | "lessThan"
  | "lessThanOrEqual"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "before"
  | "after"
  | "semVerEqual"
  | "semVerLessThan"
  | "semVerGreaterThan";

export type LDListFeatureFlagsResponse = {
  _links: {
    self: {
      href: string; // "/api/v2/flags/default?summary=true"
    };
  };
  items: {
    key: string;
    name: string;
    description: string;
    kind: string;
    tags: string[];
    variations: {
      _id: string;
      value: unknown; // maps to `kind`
    }[];
    _maintainer?: {
      email: string;
      firstName: string;
      lastName: string;
      role: string;
    };
    defaults?: {
      onVariation: number;
      offVariation: number;
    };
    environments: {
      [key: string]: {
        on: boolean;
        _environmentName: string;
        archived: boolean;
        fallthrough?: {
          variation?: number;
        };
        offVariation?: number;
        prerequisites?: {
          key: string;
          variation: number;
        }[];
        targets?: {
          values: string[];
          variation: number;
        }[];
        contextTargets?: {
          values: string[];
          variation: number;
        }[];
        rules?: {
          _id?: string;
          description?: string;
          variation?: number;
          clauses?: {
            attribute: string;
            op: LDOperator;
            values: unknown[];
            negate: boolean;
          }[];
          rollout?: {
            variations: {
              variation: number;
              weight: number;
            }[];
            experimentAllocation?: {
              defaultVariation: number;
              canReshuffle: boolean;
            };
            seed?: number;
            bucketBy?: string;
          };
        }[];
        _summary: {
          variations: {
            // key is a number as a string, e.g. '0', '1'
            [key: string]: {
              isFallthrough?: boolean;
              isOff?: boolean;
              nullRules: number;
              rules: number;
              targets: number;
            };
          };
        };
      };
    };
  }[];
};

function transformLDClause(
  key: string,
  op: LDOperator,
  values: unknown[],
  negate: boolean,
): null | ConditionInterface {
  if (!values.length) {
    throw new Error("No values in rule clause");
  }

  // Shortcut for in/nin operator
  if (op === "in") {
    if (values.length === 1) {
      return {
        [key]: {
          [negate ? "$ne" : "$eq"]: values[0],
        },
      };
    }

    return {
      [key]: {
        [negate ? "$nin" : "$in"]: values,
      },
    };
  }

  // Otherwise, need to build an `$or` or `$nor` condition
  const ors: ConditionInterface[] = [];
  values.forEach((value) => {
    const escaped = String(value).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    if (op === "endsWith") {
      ors.push({
        [key]: {
          $regex: new RegExp(`${escaped}$`),
        },
      });
    } else if (op === "startsWith") {
      ors.push({
        [key]: {
          $regex: new RegExp(`^${escaped}`),
        },
      });
    } else if (op === "matches") {
      ors.push({
        [key]: {
          $regex: String(value),
        },
      });
    } else if (op === "contains") {
      ors.push({
        [key]: {
          $regex: escaped,
        },
      });
    } else if (op === "greaterThan") {
      ors.push({
        [key]: {
          $gt: value,
        },
      });
    } else if (op === "greaterThanOrEqual") {
      ors.push({
        [key]: {
          $gte: value,
        },
      });
    } else if (op === "lessThan") {
      ors.push({
        [key]: {
          $lt: value,
        },
      });
    } else if (op === "lessThanOrEqual") {
      ors.push({
        [key]: {
          $lte: value,
        },
      });
    } else if (op === "semVerEqual") {
      ors.push({
        [key]: {
          $veq: value,
        },
      });
    } else if (op === "semVerLessThan") {
      ors.push({
        [key]: {
          $vlt: value,
        },
      });
    } else if (op === "semVerGreaterThan") {
      ors.push({
        [key]: {
          $vgt: value,
        },
      });
    } else if (op === "before") {
      ors.push({
        [key]: {
          $lt: String(value),
        },
      });
    } else if (op === "after") {
      ors.push({
        [key]: {
          $gt: String(value),
        },
      });
    } else if (op === "segmentMatch") {
      ors.push({
        // Attribute is also set to `segmentMatch`, which isn't very useful
        // Default to `id` instead
        id: {
          $inGroup: value,
        },
      });
    } else {
      throw new Error(`Unknown LD operator: ${op}`);
    }
  });

  if (ors.length === 1) {
    return negate ? { $not: ors[0] } : ors[0];
  } else if (ors.length > 1) {
    return negate ? { $nor: ors } : { $or: ors };
  }

  return null;
}

export function getTypeAndVariations(
  data: LDListFeatureFlagsResponse["items"][0],
): { type: FeatureValueType; variations: string[] } {
  const valueType =
    data.kind === "boolean"
      ? "boolean"
      : typeof data.variations[0].value === "number"
        ? "number"
        : typeof data.variations[0].value === "string"
          ? "string"
          : "json";

  const variationValues = data.variations.map((v) => {
    if (valueType === "boolean") {
      return v.value ? "true" : "false";
    }
    if (valueType === "string") {
      return String(v.value);
    }
    return JSON.stringify(v.value);
  });

  return { type: valueType, variations: variationValues };
}

// eslint-disable-next-line
function getJSONValue(type: FeatureValueType, value: string): any {
  if (type === "json") {
    try {
      return JSON.parse(value);
    } catch (e) {
      return null;
    }
  }
  if (type === "number") return parseFloat(value) || 0;
  if (type === "string") return value;
  if (type === "boolean") return value === "false" ? false : true;
  return null;
}

export const transformLDFeatureFlag = (
  data: LDListFeatureFlagsResponse["items"][0],
  project: string,
  featureVarMap: FeatureVariationsMap = new Map(),
): Omit<
  FeatureInterface,
  "dateCreated" | "dateUpdated" | "version" | "organization"
> => {
  const { description, environments, key, name, tags, _maintainer } = data;

  const envKeys = Object.keys(environments);

  const { type: valueType, variations: variationValues } =
    getTypeAndVariations(data);

  function getFallthroughForEnvironments(envKey: string): number | null {
    const envData = environments[envKey];
    if (envData.fallthrough?.variation !== undefined) {
      return envData.fallthrough.variation;
    } else {
      const fallthroughFromSummary = [
        ...Object.entries(envData._summary?.variations || {}),
      ].find((v) => v[1].isFallthrough)?.[0];

      if (fallthroughFromSummary !== undefined) {
        return Number(fallthroughFromSummary);
      }
    }
    return null;
  }

  const fallthroughs = new Map<number, number>();
  fallthroughs.set(0, 0.5);
  envKeys.forEach((envKey) => {
    const fallthrough = getFallthroughForEnvironments(envKey);
    if (fallthrough !== null) {
      fallthroughs.set(fallthrough, (fallthroughs.get(fallthrough) || 0) + 1);
    }
  });

  // Set default to the most common fallthrough
  const defaultValueIndex =
    Array.from(fallthroughs.entries()).sort((a, b) => b[1] - a[1])[0][0] || 0;
  const defaultValue = variationValues[defaultValueIndex];

  const gbEnvironments: FeatureInterface["environmentSettings"] = {};
  envKeys.forEach((envKey) => {
    const envData = environments[envKey];

    const rules: FeatureRule[] = [];

    // If there are prerequisites, add force rules to the top
    if (envData.prerequisites?.length) {
      // Value to force when any prerequisite is not met
      const offVariationIndex =
        envData.offVariation ?? data.defaults?.offVariation ?? 0;
      const offVariation = variationValues[offVariationIndex];

      envData.prerequisites.forEach((prereq, i) => {
        const { key, variation } = prereq;
        const parentFeature = featureVarMap.get(key);

        if (!parentFeature) {
          throw new Error(
            `Unknown prerequisite feature ${key} (referenced from feature ${data.key})`,
          );
        }

        const parentJSONValue = getJSONValue(
          parentFeature.type,
          parentFeature.variations[variation] || "",
        );

        // Need to invert the condition since we want this rule to match if the prerequisite is not met
        const invertedCondition: ConditionInterface =
          parentFeature.type === "boolean"
            ? { $eq: !parentJSONValue }
            : { $ne: parentJSONValue };

        rules.push({
          type: "force",
          id: `rule_prereqs_${i}`,
          description: `Prerequisite feature ${i + 1}`,
          prerequisites: [
            {
              id: key,
              condition: JSON.stringify({ value: invertedCondition }),
            },
          ],
          condition: "",
          enabled: true,
          value: offVariation,
          savedGroups: [],
        });
      });
    }

    // First add targeting rules
    const targets: { values: string[]; variation: number }[] = [];
    (envData.targets || [])
      .concat(envData.contextTargets || [])
      .forEach((t) => {
        if (t?.values?.length) {
          targets.push(t);
        }
      });
    targets.forEach((target, i) => {
      rules.push({
        type: "force",
        id: `rule_targets_${i}`,
        description: "Targets",
        condition: JSON.stringify({
          id: {
            $in: target.values,
          },
        }),
        enabled: true,
        value: variationValues[target.variation],
        savedGroups: [],
      });
    });

    // Then add other rules
    (envData.rules || []).forEach((rule, i) => {
      try {
        const ands: ConditionInterface[] = [];
        (rule.clauses || []).forEach((clause) => {
          const cond = transformLDClause(
            clause.attribute,
            clause.op,
            clause.values,
            clause.negate,
          );
          if (cond) {
            ands.push(cond);
          }
        });

        const cond = ands.length === 1 ? ands[0] : { $and: ands };

        if (rule.rollout) {
          const totalWeight = rule.rollout.variations.reduce(
            (sum, v) => sum + v.weight,
            0,
          );
          const coverage = Math.min(1, Math.max(totalWeight / 100000, 0));

          rules.push({
            type: "experiment",
            id: rule._id || `rule_${i}`,
            description: rule.description || "",
            condition: JSON.stringify(cond),
            enabled: true,
            hashAttribute: rule.rollout.bucketBy || "id",
            trackingKey: (rule.rollout.seed || rule._id || "") + "",
            values: rule.rollout.variations.map((v) => ({
              value: variationValues[v.variation],
              weight: v.weight / totalWeight,
            })),
            coverage: coverage,
            savedGroups: [],
          });
          return;
        }

        if (rule.variation == null) {
          throw new Error("Rule found without a variation");
        }

        rules.push({
          type: "force",
          id: rule._id || `rule_${i}`,
          description: rule.description || "",
          condition: JSON.stringify(cond),
          enabled: true,
          value: variationValues[rule.variation],
          savedGroups: [],
        });
      } catch (e) {
        console.error("Error transforming rule", e, {
          envKey,
          rule,
          featurekey: key,
        });
      }
    });

    // If fallback for this environment is different from the default,
    // add a force rule without a condition to the end
    const fallthrough = getFallthroughForEnvironments(envKey);
    if (fallthrough !== null && fallthrough !== defaultValueIndex) {
      rules.push({
        type: "force",
        id: `rule_fallthrough`,
        description: "Fallthrough",
        enabled: true,
        value: variationValues[fallthrough],
        condition: "{}",
        savedGroups: [],
      });
    }

    gbEnvironments[envKey] = {
      enabled: environments[envKey].on,
      rules: rules,
    };
  });

  const owner = _maintainer
    ? `${_maintainer.firstName} ${_maintainer.lastName} (${_maintainer.email})`
    : "";

  return {
    environmentSettings: gbEnvironments,
    defaultValue: defaultValue,
    project,
    id: key,
    description: description || (name === key ? "" : name),
    owner,
    tags,
    valueType: valueType,
  };
};

export type FeatureVariationsMap = Map<
  string,
  { type: FeatureValueType; variations: string[] }
>;

export const transformLDFeatureFlagToGBFeature = (
  data: LDListFeatureFlagsResponse,
  project: string,
): Omit<
  FeatureInterface,
  "organization" | "dateUpdated" | "dateCreated" | "version"
>[] => {
  // Build a map of feature key to type and variations
  // This is required for prerequisites
  const featureVarMap: FeatureVariationsMap = new Map();
  data.items.forEach((item) => {
    featureVarMap.set(item.key, getTypeAndVariations(item));
  });

  const alreadyImported = new Set<string>();

  const features: Omit<
    FeatureInterface,
    "organization" | "dateUpdated" | "dateCreated" | "version"
  >[] = [];
  data.items.forEach((item) => {
    // Prevent importing the same duplicate feature id multiple times
    if (alreadyImported.has(item.key)) {
      console.error(
        `Skipping duplicate feature '${item.key}' in project '${project}'`,
      );
      return;
    }
    alreadyImported.add(item.key);

    const feature = transformLDFeatureFlag(item, project, featureVarMap);
    features.push(feature);
  });
  return features;
};

/**
 * Make a get request to LD with the provided API token
 * @param url
 * @param apiToken
 * @param useBackendProxy
 * @param apiCall
 * @param merge
 */
async function getFromLD<ResType>(
  url: string,
  apiToken: string,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
  merge?: (existing: ResType, next: ResType) => ResType,
): Promise<ResType> {
  // Pagination queue
  const fetchPage = async (url: string, result?: ResType) => {
    if (useBackendProxy && apiCall) {
      // Use backend proxy
      const response = await apiCall("/importing/launchdarkly", {
        method: "POST",
        body: JSON.stringify({
          url,
          apiToken,
        }),
      });

      // Handle error responses from the proxy
      if (response.status && response.status >= 400) {
        throw new Error(
          response.message || `LaunchDarkly API error: ${response.status}`,
        );
      }

      const data = response;

      if (merge) {
        // Merge this page into the existing result
        result = result ? merge(result, data) : data;

        // If there's a next page, recursively fetch it
        if (data?._links?.next?.href) {
          result = await fetchPage(data._links.next.href, result);
        }
      } else {
        // Merging not supported, just return the data
        result = data;
      }

      return result as ResType;
    }

    const response = await fetch(`https://app.launchdarkly.com${url}`, {
      headers: {
        Authorization: apiToken,
      },
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }

    const data = await response.json();
    if (merge) {
      // Merge this page into the existing result
      result = result ? merge(result, data) : data;

      // If there's a next page, recursively fetch it
      if (data?._links?.next?.href) {
        result = await fetchPage(data._links.next.href, result);
      }
    } else {
      // Merging not supported, just return the data
      result = data;
    }

    return result as ResType;
  };

  return fetchPage(url);
}

export const getLDProjects = async (
  apiToken: string,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<LDListProjectsResponse> =>
  getFromLD(
    "/api/v2/projects?limit=300",
    apiToken,
    useBackendProxy,
    apiCall,
    (existing, next) => {
      existing.items = [...existing.items, ...next.items];
      return existing;
    },
  );

export const getLDEnvironments = async (
  apiToken: string,
  project: string,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<LDListEnvironmentsResponse> =>
  getFromLD(
    `/api/v2/projects/${project}/environments?limit=300`,
    apiToken,
    useBackendProxy,
    apiCall,
    (existing, next) => {
      existing.items = [...existing.items, ...next.items];
      return existing;
    },
  );

export const getLDFeatureFlags = async (
  apiToken: string,
  project: string,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<LDListFeatureFlagsResponse> =>
  getFromLD(
    `/api/v2/flags/${project}`,
    apiToken,
    useBackendProxy,
    apiCall,
    (existing, next) => {
      existing.items = [...existing.items, ...next.items];
      return existing;
    },
  );

export const getLDFeatureFlag = async (
  apiToken: string,
  project: string,
  key: string,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<LDListFeatureFlagsResponse["items"][0]> =>
  getFromLD(
    `/api/v2/flags/${project}/${key}`,
    apiToken,
    useBackendProxy,
    apiCall,
  );

// endregion LD
