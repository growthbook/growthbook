import { ProjectInterface } from "back-end/types/project";
import { Environment } from "back-end/types/organization";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import uniqid from "uniqid";
import { ConditionInterface } from "@growthbook/growthbook-react";

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
  data: LDListProjectsResponse
): Pick<ProjectInterface, "name" | "description">[] => {
  return data.items.map(({ key, name }) => ({
    name: key,
    description: name,
  }));
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
  data: LDListEnvironmentsResponse
): Environment[] => {
  return data.items.map(({ key, name }) => ({
    id: key,
    description: name,
  }));
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
    environments: {
      [key: string]: {
        on: boolean;
        _environmentName: string;
        archived: boolean;
        fallthrough?: {
          variation?: number;
        };
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
  negate: boolean
): null | ConditionInterface {
  if (!values.length) {
    console.error("No values in rule clause");
    return null;
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
    } else {
      console.error("Unknown LD operator", op);
    }
  });

  if (ors.length === 1) {
    return negate ? { $not: ors[0] } : ors[0];
  } else if (ors.length > 1) {
    return negate ? { $nor: ors } : { $or: ors };
  }

  return null;
}

export const transformLDFeatureFlagToGBFeature = (
  data: LDListFeatureFlagsResponse,
  project: string
): Omit<
  FeatureInterface,
  "dateCreated" | "dateUpdated" | "version" | "organization"
>[] => {
  return data.items.map(
    ({
      _maintainer,
      environments,
      key,
      kind,
      variations,
      name,
      description,
      tags,
    }) => {
      const envKeys = Object.keys(environments);
      const valueType =
        kind === "boolean"
          ? "boolean"
          : typeof variations[0].value === "number"
          ? "number"
          : typeof variations[0].value === "string"
          ? "string"
          : "json";

      const variationValues = variations.map((v) => {
        if (valueType === "boolean") {
          return v.value ? "true" : "false";
        }
        if (valueType === "string") {
          return String(v.value);
        }
        return JSON.stringify(v.value);
      });

      const defaultValue = variationValues[0];

      const gbEnvironments: FeatureInterface["environmentSettings"] = {};
      envKeys.forEach((envKey) => {
        const envData = environments[envKey];

        const rules: FeatureRule[] = [];

        // First add targeting rules
        const targets = (envData.targets || []).concat(
          envData.contextTargets || []
        );
        targets.forEach((target) => {
          rules.push({
            type: "force",
            id: uniqid("var_"),
            description: "Targets",
            condition: JSON.stringify({
              id: {
                $in: target.values,
              },
            }),
            enabled: true,
            value: variationValues[target.variation],
          });
        });

        // Then add other rules
        (envData.rules || []).forEach((rule) => {
          const ands: ConditionInterface[] = [];
          (rule.clauses || []).forEach((clause) => {
            const cond = transformLDClause(
              clause.attribute,
              clause.op,
              clause.values,
              clause.negate
            );
            if (cond) {
              ands.push(cond);
            }
          });

          const cond = ands.length === 1 ? ands[0] : { $and: ands };

          if (rule.rollout) {
            console.error("Rollouts not yet supported");
            return;
          }

          if (!rule.variation) {
            console.error("Rule without a variation");
            return;
          }

          rules.push({
            type: "force",
            id: uniqid("var_"),
            description: rule.description || "",
            condition: JSON.stringify(cond),
            enabled: true,
            value: variationValues[rule.variation],
          });
        });

        // If fallback for this environment is different from the default,
        // add a force rule without a condition to the end
        if (envData.fallthrough?.variation) {
          rules.push({
            type: "force",
            id: uniqid("var_"),
            description: "Fallthrough",
            enabled: true,
            value: variationValues[envData.fallthrough.variation],
          });
        }

        gbEnvironments[envKey] = {
          enabled: environments[envKey].on,
          rules: rules,
        };
      });

      const owner = _maintainer
        ? `${_maintainer.firstName} ${_maintainer.lastName} (${_maintainer.email})`
        : "(unknown - imported from LaunchDarkly)";

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
    }
  );
};

/**
 * Make a get request to LD with the provided API token
 * @param url
 * @param apiToken
 */
async function getFromLD<ResType>(
  url: string,
  apiToken: string
): Promise<ResType> {
  const response = await fetch(url, {
    headers: {
      Authorization: apiToken,
    },
  });
  if (!response.ok) {
    throw new Error(response.statusText);
  }

  return await response.json();
}

export const getLDProjects = async (
  apiToken: string
): Promise<LDListProjectsResponse> =>
  getFromLD("https://app.launchdarkly.com/api/v2/projects", apiToken);

export const getLDEnvironments = async (
  apiToken: string,
  project: string
): Promise<LDListEnvironmentsResponse> =>
  getFromLD(
    `https://app.launchdarkly.com/api/v2/projects/${project}/environments`,
    apiToken
  );

export const getLDFeatureFlags = async (
  apiToken: string,
  project: string
): Promise<LDListFeatureFlagsResponse> =>
  getFromLD(`https://app.launchdarkly.com/api/v2/flags/${project}`, apiToken);

// endregion LD
