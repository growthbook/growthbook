import {
  FeatureDefinitionRule,
  FeatureDefinition,
  ApiFeatureInterface,
  ApiFeatureEnvironmentInterface,
} from "../../types/api";
import {
  FeatureDraftChanges,
  FeatureEnvironment,
  FeatureInterface,
  FeatureRule,
  FeatureValueType,
} from "../../types/feature";
import { queueWebhook } from "../jobs/webhooks";
import { getAllFeatures } from "../models/FeatureModel";
import uniqid from "uniqid";
import isEqual from "lodash/isEqual";
import { webcrypto as crypto } from "node:crypto";
import { replaceSavedGroupsInCondition } from "../util/features";
import { getAllSavedGroups } from "../models/SavedGroupModel";
import { getEnvironments, getOrganizationById } from "./organizations";
import { OrganizationInterface } from "../../types/organization";

export type GroupMap = Map<string, string[] | number[]>;
export type AttributeMap = Map<string, string>;

function roundVariationWeight(num: number): number {
  return Math.round(num * 1000) / 1000;
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

export function getFeatureDefinition({
  feature,
  environment,
  groupMap,
  useDraft = false,
}: {
  feature: FeatureInterface;
  environment: string;
  groupMap: GroupMap;
  useDraft?: boolean;
}): FeatureDefinition | null {
  const settings = feature.environmentSettings?.[environment];

  // Don't include features which are disabled for this environment
  if (!settings || !settings.enabled || feature.archived) {
    return null;
  }

  const draft = feature.draft;
  if (!draft?.active) {
    useDraft = false;
  }

  const defaultValue = useDraft
    ? draft?.defaultValue ?? feature.defaultValue
    : feature.defaultValue;

  const rules = useDraft
    ? draft?.rules?.[environment] ?? settings.rules
    : settings.rules;

  const def: FeatureDefinition = {
    defaultValue: getJSONValue(feature.valueType, defaultValue),
    rules:
      rules
        ?.filter((r) => r.enabled)
        ?.filter((r) => {
          //Filter our rules that have schedulingRules if the current scheduleRule sets the feature to disabled.
          const currentDate = new Date().valueOf();

          if (!r.scheduleRules || !r.scheduleRules.length) {
            return true;
          }

          // Ensure the scheduleRules are sorted by date
          const sortedScheduleRules = r.scheduleRules.sort(
            (a, b) =>
              new Date(a.timestamp).valueOf() - new Date(b.timestamp).valueOf()
          );

          // Loop through the list of rules, and find the last rule that was applied
          const nextRuleIndex = sortedScheduleRules.findIndex(
            (rule) => currentDate < new Date(rule.timestamp).valueOf()
          );

          if (nextRuleIndex === -1) {
            return sortedScheduleRules[sortedScheduleRules.length - 1]
              .enableFeature;
          } else {
            return !sortedScheduleRules[nextRuleIndex].enableFeature;
          }
        })
        ?.map((r) => {
          const rule: FeatureDefinitionRule = {};
          if (r.condition && r.condition !== "{}") {
            try {
              rule.condition = JSON.parse(
                replaceSavedGroupsInCondition(r.condition, groupMap)
              );
            } catch (e) {
              // ignore condition parse errors here
            }
          }

          if (r.type === "force") {
            rule.force = getJSONValue(feature.valueType, r.value);
          } else if (r.type === "experiment") {
            rule.variations = r.values.map((v) =>
              getJSONValue(feature.valueType, v.value)
            );

            rule.coverage = r.coverage;

            rule.weights = r.values
              .map((v) => v.weight)
              .map((w) => (w < 0 ? 0 : w > 1 ? 1 : w))
              .map((w) => roundVariationWeight(w));

            if (r.trackingKey) {
              rule.key = r.trackingKey;
            }
            if (r.hashAttribute) {
              rule.hashAttribute = r.hashAttribute;
            }
            if (r?.namespace && r.namespace.enabled && r.namespace.name) {
              rule.namespace = [
                r.namespace.name,
                // eslint-disable-next-line
                parseFloat(r.namespace.range[0] as any) || 0,
                // eslint-disable-next-line
                parseFloat(r.namespace.range[1] as any) || 0,
              ];
            }
          } else if (r.type === "rollout") {
            rule.force = getJSONValue(feature.valueType, r.value);
            rule.coverage =
              r.coverage > 1 ? 1 : r.coverage < 0 ? 0 : r.coverage;

            if (r.hashAttribute) {
              rule.hashAttribute = r.hashAttribute;
            }
          }
          return rule;
        }) ?? [],
  };
  if (def.rules && !def.rules.length) {
    delete def.rules;
  }

  return def;
}

export async function getSavedGroupMap(
  organization: OrganizationInterface
): Promise<GroupMap> {
  const attributes = organization.settings?.attributeSchema;

  const attributeMap: AttributeMap = new Map();
  attributes?.forEach((attribute) => {
    attributeMap.set(attribute.property, attribute.datatype);
  });

  // Get "SavedGroups" for an organization and build a map of the SavedGroup's Id to the actual array of IDs, respecting the type.
  const allGroups = await getAllSavedGroups(organization.id);

  function getGroupValues(
    values: string[],
    type?: string
  ): string[] | number[] {
    if (type === "number") {
      return values.map((v) => parseFloat(v));
    }
    return values;
  }

  const groupMap: GroupMap = new Map(
    allGroups.map((group) => {
      const attributeType = attributeMap?.get(group.attributeKey);
      const values = getGroupValues(group.values, attributeType);
      return [group.id, values];
    })
  );

  return groupMap;
}

export async function getFeatureDefinitions(
  organization: string,
  environment: string = "production",
  project?: string
): Promise<{
  features: Record<string, FeatureDefinition>;
  dateUpdated: Date | null;
}> {
  const org = await getOrganizationById(organization);
  if (!org) {
    return {
      features: {},
      dateUpdated: null,
    };
  }

  const features = await getAllFeatures(organization, project);
  const groupMap = await getSavedGroupMap(org);

  const defs: Record<string, FeatureDefinition> = {};
  let mostRecentUpdate: Date | null = null;
  features.forEach((feature) => {
    const def = getFeatureDefinition({
      feature,
      environment,
      groupMap,
    });
    if (def) {
      defs[feature.id] = def;

      if (!mostRecentUpdate || mostRecentUpdate < feature.dateUpdated) {
        mostRecentUpdate = feature.dateUpdated;
      }
    }
  });

  return { features: defs, dateUpdated: mostRecentUpdate };
}

export function getEnabledEnvironments(feature: FeatureInterface) {
  return Object.keys(feature.environmentSettings ?? {}).filter((env) => {
    return !!feature.environmentSettings?.[env]?.enabled;
  });
}

export function generateRuleId() {
  return uniqid("fr_");
}

export function addIdsToRules(
  environmentSettings: Record<string, FeatureEnvironment> = {},
  featureId: string
) {
  Object.values(environmentSettings).forEach((env) => {
    if (env.rules && env.rules.length) {
      env.rules.forEach((r) => {
        if (r.type === "experiment" && !r?.trackingKey) {
          r.trackingKey = featureId;
        }
        if (!r.id) {
          r.id = generateRuleId();
        }
      });
    }
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

export async function featureUpdated(
  feature: FeatureInterface,
  previousEnvironments: string[] = [],
  previousProject: string = ""
) {
  const currentEnvironments = getEnabledEnvironments(feature);

  // fire the webhook:
  await queueWebhook(
    feature.organization,
    [...currentEnvironments, ...previousEnvironments],
    [previousProject || "", feature.project || ""],
    true
  );
}

// eslint-disable-next-line
export function arrayMove(array: Array<any>, from: number, to: number) {
  const newArray = array.slice();
  newArray.splice(
    to < 0 ? newArray.length + to : to,
    0,
    newArray.splice(from, 1)[0]
  );
  return newArray;
}

export function verifyDraftsAreEqual(
  actual?: FeatureDraftChanges,
  expected?: FeatureDraftChanges
) {
  if (
    !isEqual(
      {
        defaultValue: actual?.defaultValue,
        rules: actual?.rules,
      },
      {
        defaultValue: expected?.defaultValue,
        rules: expected?.rules,
      }
    )
  ) {
    throw new Error(
      "New changes have been made to this feature. Please review and try again."
    );
  }
}

export async function encrypt(
  plainText: string,
  keyString: string | undefined
): Promise<string> {
  if (!keyString) {
    throw new Error("Unable to encrypt the feature list.");
  }
  const bufToBase64 = (x: ArrayBuffer) => Buffer.from(x).toString("base64");
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(keyString, "base64"),
    {
      name: "AES-CBC",
      length: 128,
    },
    true,
    ["encrypt", "decrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-CBC",
      iv,
    },
    key,
    new TextEncoder().encode(plainText)
  );
  return bufToBase64(iv) + "." + bufToBase64(encryptedBuffer);
}

export function getApiFeatureObj(
  feature: FeatureInterface,
  organization: OrganizationInterface,
  groupMap: GroupMap
): ApiFeatureInterface {
  const featureEnvironments: Record<
    string,
    ApiFeatureEnvironmentInterface
  > = {};
  const environments = getEnvironments(organization);
  environments.forEach((env) => {
    const defaultValue = feature.defaultValue;
    const envSettings = feature.environmentSettings?.[env.id];
    const enabled = !!envSettings?.enabled;
    const rules = envSettings?.rules || [];
    const definition = getFeatureDefinition({
      feature,
      groupMap,
      environment: env.id,
    });

    const draft = feature.draft?.active
      ? {
          enabled,
          defaultValue: feature.draft?.defaultValue ?? defaultValue,
          rules: feature.draft?.rules?.[env.id] ?? rules,
          definition: getFeatureDefinition({
            feature,
            groupMap,
            environment: env.id,
            useDraft: true,
          }),
        }
      : null;

    featureEnvironments[env.id] = {
      defaultValue,
      enabled,
      rules,
      draft,
      definition,
    };
  });

  const featureRecord: ApiFeatureInterface = {
    id: feature.id,
    description: feature.description || "",
    archived: !!feature.archived,
    dateCreated: feature.dateCreated.toISOString(),
    dateUpdated: feature.dateUpdated.toISOString(),
    defaultValue: feature.defaultValue,
    environments: featureEnvironments,
    owner: feature.owner || "",
    project: feature.project || "",
    tags: feature.tags || [],
    valueType: feature.valueType,
    revision: {
      comment: feature.revision?.comment || "",
      date: (feature.revision?.date || feature.dateCreated).toISOString(),
      publishedBy: feature.revision?.publishedBy?.email || "",
      version: feature.revision?.version || 1,
    },
  };

  return featureRecord;
}

export function getNextScheduledUpdate(
  envSettings: Record<string, FeatureEnvironment>
) {
  if (!envSettings) {
    return null;
  }

  const dates: string[] = [];

  if (envSettings) {
    for (const env in envSettings) {
      const rules = envSettings[env].rules;

      rules.forEach((rule: FeatureRule) => {
        if (rule.scheduleRules) {
          rule.scheduleRules.forEach((scheduleRule) => {
            dates.push(scheduleRule.timestamp);
          });
        }
      });
    }
  }

  const sortedFutureDates = dates
    .filter((date) => new Date(date) > new Date())
    .sort();

  if (sortedFutureDates.length === 0) {
    return null;
  }

  return new Date(sortedFutureDates[0]);
}
