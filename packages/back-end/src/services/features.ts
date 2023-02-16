import { webcrypto as crypto } from "node:crypto";
import uniqid from "uniqid";
import isEqual from "lodash/isEqual";
import {
  ApiFeatureEnvironmentInterface,
  ApiFeatureInterface,
  FeatureDefinition,
} from "../../types/api";
import {
  FeatureDraftChanges,
  FeatureEnvironment,
  FeatureInterface,
  FeatureRule,
} from "../../types/feature";
import { getAllFeatures } from "../models/FeatureModel";
import { getFeatureDefinition } from "../util/features";
import { getAllSavedGroups } from "../models/SavedGroupModel";
import { OrganizationInterface } from "../../types/organization";
import { getSDKPayload, updateSDKPayload } from "../models/SdkPayloadModel";
import { logger } from "../util/logger";
import { promiseAllChunks } from "../util/promise";
import { queueWebhook } from "../jobs/webhooks";
import { GroupMap } from "../../types/saved-group";
import { SDKPayloadKey } from "../../types/sdk-payload";
import { queueProxyUpdate } from "../jobs/proxyUpdate";
import { getEnvironments, getOrganizationById } from "./organizations";

export type AttributeMap = Map<string, string>;

function generatePayload(
  features: FeatureInterface[],
  environment: string,
  groupMap: GroupMap
): Record<string, FeatureDefinition> {
  const defs: Record<string, FeatureDefinition> = {};
  features.forEach((feature) => {
    const def = getFeatureDefinition({
      feature,
      environment,
      groupMap,
    });
    if (def) {
      defs[feature.id] = def;
    }
  });

  return defs;
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

export async function refreshSDKPayloadCache(
  organization: OrganizationInterface,
  payloadKeys: SDKPayloadKey[],
  allFeatures: FeatureInterface[] | null = null
) {
  // Ignore any old environments which don't exist anymore
  const allowedEnvs = new Set(
    organization.settings?.environments?.map((e) => e.id) || []
  );
  payloadKeys = payloadKeys.filter((k) => allowedEnvs.has(k.environment));

  // If no environments are affected, we don't need to update anything
  if (!payloadKeys.length) return;

  const groupMap = await getSavedGroupMap(organization);
  allFeatures = allFeatures || (await getAllFeatures(organization.id));

  // For each affected project/environment pair, generate a new SDK payload and update the cache
  const promises: (() => Promise<void>)[] = [];
  for (const key of payloadKeys) {
    const projectFeatures = key.project
      ? allFeatures.filter((f) => f.project === key.project)
      : allFeatures;

    if (!projectFeatures.length) continue;

    const featureDefinitions = generatePayload(
      projectFeatures,
      key.environment,
      groupMap
    );

    promises.push(async () => {
      await updateSDKPayload({
        organization: organization.id,
        project: key.project,
        environment: key.environment,
        featureDefinitions,
      });
    });
  }

  // If there are no changes, we don't need to do anything
  if (!promises.length) return;

  // Vast majority of the time, there will only be 1 or 2 promises
  // However, there could be a lot if an org has many enabled environments
  // Batch the promises in chunks of 4 at a time to avoid overloading Mongo
  await promiseAllChunks(promises, 4);

  // After the SDK payloads are updated, fire any webhooks on the organization
  await queueWebhook(organization.id, payloadKeys, true);

  // Update any Proxy servers that are affected by this change
  await queueProxyUpdate(organization.id, payloadKeys);
}

async function getFeatureDefinitionsResponse(
  features: Record<string, FeatureDefinition>,
  dateUpdated: Date | null,
  encryptionKey?: string
) {
  if (!encryptionKey) {
    return {
      features,
      dateUpdated,
    };
  }

  const encryptedFeatures = await encrypt(
    JSON.stringify(features),
    encryptionKey
  );

  return {
    features: {},
    dateUpdated,
    encryptedFeatures,
  };
}

export async function getFeatureDefinitions(
  organization: string,
  environment: string = "production",
  project?: string,
  encryptionKey?: string
): Promise<{
  features: Record<string, FeatureDefinition>;
  dateUpdated: Date | null;
  encryptedFeatures?: string;
}> {
  // Return cached payload from Mongo if exists
  try {
    const cached = await getSDKPayload({
      organization,
      environment,
      project: project || "",
    });
    if (cached) {
      const { features } = cached.contents;
      return await getFeatureDefinitionsResponse(
        features,
        cached.dateUpdated,
        encryptionKey
      );
    }
  } catch (e) {
    logger.error(e, "Failed to fetch SDK payload from cache");
  }

  const org = await getOrganizationById(organization);
  if (!org) {
    return await getFeatureDefinitionsResponse({}, null, encryptionKey);
  }

  // Generate the feature definitions
  const features = await getAllFeatures(organization, project);
  const groupMap = await getSavedGroupMap(org);
  const featureDefinitions = generatePayload(features, environment, groupMap);

  // Cache in Mongo
  await updateSDKPayload({
    organization,
    project: project || "",
    environment,
    featureDefinitions,
  });

  return await getFeatureDefinitionsResponse(
    featureDefinitions,
    new Date(),
    encryptionKey
  );
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

export function arrayMove<T>(
  array: Array<T>,
  from: number,
  to: number
): Array<T> {
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
): Date | null {
  if (!envSettings) {
    return null;
  }

  const dates: string[] = [];

  for (const env in envSettings) {
    const rules = envSettings[env].rules;

    if (!rules) continue;

    rules.forEach((rule: FeatureRule) => {
      if (rule?.scheduleRules) {
        rule.scheduleRules.forEach((scheduleRule) => {
          if (scheduleRule.timestamp !== null) {
            dates.push(scheduleRule.timestamp);
          }
        });
      }
    });
  }

  const sortedFutureDates = dates
    .filter((date) => new Date(date) > new Date())
    .sort();

  if (sortedFutureDates.length === 0) {
    return null;
  }

  return new Date(sortedFutureDates[0]);
}
