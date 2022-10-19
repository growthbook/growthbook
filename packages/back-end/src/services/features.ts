import { FeatureDefinitionRule, FeatureDefinition } from "../../types/api";
import {
  FeatureDraftChanges,
  FeatureEnvironment,
  FeatureInterface,
  FeatureValueType,
} from "../../types/feature";
import { queueWebhook } from "../jobs/webhooks";
import { getAllFeatures } from "../models/FeatureModel";
import uniqid from "uniqid";
import isEqual from "lodash/isEqual";
import { getKeyFromString } from "../util/subtle-crypto";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const crypto = require("node:crypto").webcrypto;
import { replaceSavedGroupsInCondition } from "../util/features";
import { getAllSavedGroups } from "../models/SavedGroupModel";
import { getOrganizationById } from "./organizations";

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
export async function getFeatureDefinitions(
  organization: string,
  environment: string = "production",
  project?: string
) {
  const features = await getAllFeatures(organization, project);

  const org = await getOrganizationById(organization);

  const attributes = org?.settings?.attributeSchema;

  const attributeMap: AttributeMap = new Map();
  attributes?.forEach((attribute) => {
    attributeMap.set(attribute.property, attribute.datatype);
  });

  // Get "SavedGroups" for an organization and build a map of the SavedGroup's Id to the actual array of IDs, respecting the type.
  const allGroups = await getAllSavedGroups(organization);

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

  const defs: Record<string, FeatureDefinition> = {};
  let mostRecentUpdate: Date | null = null;
  features.forEach((feature) => {
    const settings = feature.environmentSettings?.[environment];

    // Don't include features which are disabled for this environment
    if (!settings || !settings.enabled || feature.archived) {
      return;
    }

    if (!mostRecentUpdate || mostRecentUpdate < feature.dateUpdated) {
      mostRecentUpdate = feature.dateUpdated;
    }

    defs[feature.id] = {
      defaultValue: getJSONValue(feature.valueType, feature.defaultValue),
      rules:
        settings.rules
          ?.filter((r) => r.enabled)
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
    if (defs[feature.id].rules && !defs[feature.id].rules?.length) {
      delete defs[feature.id].rules;
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

export const encrypt = async (
  features: string,
  privateKeyString: string | undefined
): Promise<{ features: string; iv: string }> => {
  if (!privateKeyString) {
    throw new Error("Unable to encrypt the feature list.");
  }

  const key = await getKeyFromString(privateKeyString);

  const iv = crypto.getRandomValues(new Uint8Array(16));

  const encryptedFeatureList = await crypto.subtle.encrypt(
    {
      name: "AES-CBC",
      iv,
    },
    key,
    new TextEncoder().encode(features)
  );

  return {
    features: Buffer.from(encryptedFeatureList).toString("base64"),
    iv: Buffer.from(iv.buffer).toString("base64"),
  };
};
