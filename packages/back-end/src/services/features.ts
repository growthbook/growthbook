import { webcrypto as crypto } from "node:crypto";
import { createHash } from "crypto";
import uniqid from "uniqid";
import fetch from "node-fetch";
import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
import { orgHasPremiumFeature } from "enterprise";
import { FeatureDefinition, FeatureDefinitionRule } from "../../types/api";
import {
  FeatureDraftChanges,
  FeatureEnvironment,
  FeatureInterface,
  FeatureRule,
} from "../../types/feature";
import { getAllFeatures } from "../models/FeatureModel";
import { getAllVisualExperiments } from "../models/ExperimentModel";
import {
  getFeatureDefinition,
  replaceSavedGroupsInCondition,
} from "../util/features";
import { getAllSavedGroups } from "../models/SavedGroupModel";
import {
  OrganizationInterface,
  SDKAttribute,
  SDKAttributeSchema,
} from "../../types/organization";
import { getSDKPayload, updateSDKPayload } from "../models/SdkPayloadModel";
import { logger } from "../util/logger";
import { promiseAllChunks } from "../util/promise";
import { queueWebhook } from "../jobs/webhooks";
import { GroupMap } from "../../types/saved-group";
import { SDKExperiment, SDKPayloadKey } from "../../types/sdk-payload";
import { queueProxyUpdate } from "../jobs/proxyUpdate";
import { ApiFeature, ApiFeatureEnvironment } from "../../types/openapi";
import { ExperimentInterface, ExperimentPhase } from "../../types/experiment";
import { VisualChangesetInterface } from "../../types/visual-changeset";
import { FASTLY_API_TOKEN, FASTLY_SERVICE_ID } from "../util/secrets";
import { getEnvironments, getOrganizationById } from "./organizations";

export type AttributeMap = Map<string, string>;

function generatePayload({
  features,
  environment,
  groupMap,
}: {
  features: FeatureInterface[];
  environment: string;
  groupMap: GroupMap;
}): Record<string, FeatureDefinition> {
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

export type VisualExperiment = {
  experiment: ExperimentInterface;
  visualChangeset: VisualChangesetInterface;
};

function generateVisualExperimentsPayload({
  visualExperiments,
  // environment,
  groupMap,
}: {
  visualExperiments: Array<VisualExperiment>;
  // environment: string,
  groupMap: GroupMap;
}): SDKExperiment[] {
  const isValidSDKExperiment = (e: SDKExperiment | null): e is SDKExperiment =>
    !!e;
  const sdkExperiments: Array<SDKExperiment | null> = visualExperiments.map(
    ({ experiment: e, visualChangeset: v }) => {
      const phase: ExperimentPhase | null = e.phases.slice(-1)?.[0] ?? null;
      const forcedVariation =
        e.status === "stopped" && e.releasedVariationId
          ? e.variations.find((v) => v.id === e.releasedVariationId)
          : null;

      let condition;
      if (phase?.condition && phase.condition !== "{}") {
        try {
          condition = JSON.parse(
            replaceSavedGroupsInCondition(phase.condition, groupMap)
          );
        } catch (e) {
          // ignore condition parse errors here
        }
      }

      if (!phase) return null;

      return {
        key: e.trackingKey,
        status: e.status,
        variations: v.visualChanges.map((vc) => ({
          css: vc.css,
          js: vc.js || "",
          domMutations: vc.domMutations,
        })),
        hashVersion: 2,
        hashAttribute: e.hashAttribute,
        urlPatterns: v.urlPatterns,
        weights: phase.variationWeights,
        meta: e.variations.map((v) => ({ key: v.key, name: v.name })),
        filters: phase.namespace.enabled
          ? [
              {
                attribute: e.hashAttribute,
                seed: phase.namespace.name,
                hashVersion: 2,
                ranges: [phase.namespace.range],
              },
            ]
          : [],
        seed: phase.seed,
        name: e.name,
        phase: `${e.phases.length - 1}`,
        force: forcedVariation
          ? e.variations.indexOf(forcedVariation)
          : undefined,
        condition,
        coverage: phase.coverage,
      };
    }
  );
  return sdkExperiments.filter(isValidSDKExperiment);
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
  allFeatures: FeatureInterface[] | null = null,
  skipRefreshForProject?: string
) {
  // Ignore any old environments which don't exist anymore
  const allowedEnvs = new Set(
    organization.settings?.environments?.map((e) => e.id) || []
  );
  payloadKeys = payloadKeys.filter((k) => allowedEnvs.has(k.environment));

  // Remove any projects to skip
  if (skipRefreshForProject) {
    payloadKeys = payloadKeys.filter(
      (k) => k.project !== skipRefreshForProject
    );
  }

  // If no environments are affected, we don't need to update anything
  if (!payloadKeys.length) return;

  const groupMap = await getSavedGroupMap(organization);
  allFeatures = allFeatures || (await getAllFeatures(organization.id));
  const allVisualExperiments = await getAllVisualExperiments(organization.id);

  // For each affected project/environment pair, generate a new SDK payload and update the cache
  const promises: (() => Promise<void>)[] = [];
  for (const key of payloadKeys) {
    const projectFeatures = key.project
      ? allFeatures.filter((f) => f.project === key.project)
      : allFeatures;
    const projectExperiments = key.project
      ? allVisualExperiments.filter((e) => e.experiment.project === key.project)
      : allVisualExperiments;

    if (!projectFeatures.length && !projectExperiments.length) continue;

    const featureDefinitions = generatePayload({
      features: projectFeatures,
      environment: key.environment,
      groupMap,
    });

    const experimentsDefinitions = generateVisualExperimentsPayload({
      visualExperiments: projectExperiments,
      // environment: key.environment,
      groupMap,
    });

    promises.push(async () => {
      await updateSDKPayload({
        organization: organization.id,
        project: key.project,
        environment: key.environment,
        featureDefinitions,
        experimentsDefinitions,
      });
    });
  }

  // If there are no changes, we don't need to do anything
  if (!promises.length) return;

  // Vast majority of the time, there will only be 1 or 2 promises
  // However, there could be a lot if an org has many enabled environments
  // Batch the promises in chunks of 4 at a time to avoid overloading Mongo
  await promiseAllChunks(promises, 4);

  // Purge CDN if used
  // Do this before firing webhooks in case a webhook tries fetching the latest payload from the CDN
  await purgeCDNCache(organization.id, payloadKeys);

  // After the SDK payloads are updated, fire any webhooks on the organization
  await queueWebhook(organization.id, payloadKeys, true);

  // Update any Proxy servers that are affected by this change
  await queueProxyUpdate(organization.id, payloadKeys);
}

export function getSurrogateKey(
  orgId: string,
  project: string,
  environment: string
) {
  // Fill with default values if missing
  project = project || "AllProjects";
  environment = environment || "production";

  const key = `${orgId}_${project}_${environment}`;

  // Protect against environments or projects having unusual characters
  return key.replace(/[^a-zA-Z0-9_-]/g, "");
}

export async function purgeCDNCache(
  orgId: string,
  payloadKeys: SDKPayloadKey[]
): Promise<void> {
  // Only purge when Fastly is used as the CDN (e.g. GrowthBook Cloud)
  if (!FASTLY_SERVICE_ID || !FASTLY_API_TOKEN) return;

  // Only purge the specific payloads that are affected
  const surrogateKeys = payloadKeys.map((k) =>
    getSurrogateKey(orgId, k.project, k.environment)
  );
  if (!surrogateKeys.length) return;

  try {
    await fetch(`https://api.fastly.com/service/${FASTLY_SERVICE_ID}/purge`, {
      method: "POST",
      headers: {
        "Fastly-Key": FASTLY_API_TOKEN,
        "surrogate-key": surrogateKeys.join(" "),
        Accept: "application/json",
      },
    });
  } catch (e) {
    logger.error("Failed to purge cache for " + orgId);
  }
}

export type FeatureDefinitionsResponseArgs = {
  features: Record<string, FeatureDefinition>;
  experiments: SDKExperiment[];
  dateUpdated: Date | null;
  encryptionKey?: string;
  includeVisualExperiments?: boolean;
  includeDraftExperiments?: boolean;
  includeExperimentNames?: boolean;
  attributes?: SDKAttributeSchema;
  secureAttributeSalt?: string;
};
async function getFeatureDefinitionsResponse({
  features,
  experiments,
  dateUpdated,
  encryptionKey,
  includeVisualExperiments,
  includeDraftExperiments,
  includeExperimentNames,
  attributes,
  secureAttributeSalt,
}: FeatureDefinitionsResponseArgs) {
  if (!includeDraftExperiments) {
    experiments = experiments?.filter((e) => e.status !== "draft") || [];
  }

  if (!includeExperimentNames) {
    // Remove experiment/variation name from every visual experiment
    experiments = experiments?.map((exp) => {
      return {
        ...omit(exp, ["name", "meta"]),
        meta: exp.meta ? exp.meta.map((m) => omit(m, ["name"])) : undefined,
      };
    });
  }

  const hasSecureAttributes = attributes?.some((a) =>
    ["secureString", "secureString[]"].includes(a.datatype)
  );
  if (attributes && hasSecureAttributes && secureAttributeSalt !== undefined) {
    features = applyFeatureHashing(features, attributes, secureAttributeSalt);

    if (experiments) {
      experiments = applyExperimentHashing(
        experiments,
        attributes,
        secureAttributeSalt
      );
    }
  }

  if (!encryptionKey) {
    return {
      features,
      ...(includeVisualExperiments && { experiments }),
      dateUpdated,
    };
  }

  const encryptedFeatures = await encrypt(
    JSON.stringify(features),
    encryptionKey
  );
  const encryptedExperiments = includeVisualExperiments
    ? await encrypt(JSON.stringify(experiments || []), encryptionKey)
    : undefined;

  return {
    features: {},
    ...(includeVisualExperiments && { experiments: [] }),
    dateUpdated,
    encryptedFeatures,
    ...(includeVisualExperiments && { encryptedExperiments }),
  };
}

export type FeatureDefinitionArgs = {
  organization: string;
  environment?: string;
  project?: string;
  encryptionKey?: string;
  includeVisualExperiments?: boolean;
  includeDraftExperiments?: boolean;
  includeExperimentNames?: boolean;
  hashSecureAttributes?: boolean;
};
export type FeatureDefinitionSDKPayload = {
  features: Record<string, FeatureDefinition>;
  experiments?: SDKExperiment[];
  dateUpdated: Date | null;
  encryptedFeatures?: string;
  encryptedExperiments?: string;
};

export async function getFeatureDefinitions({
  organization,
  environment = "production",
  project,
  encryptionKey,
  includeVisualExperiments,
  includeDraftExperiments,
  includeExperimentNames,
  hashSecureAttributes,
}: FeatureDefinitionArgs): Promise<FeatureDefinitionSDKPayload> {
  // Return cached payload from Mongo if exists
  try {
    const cached = await getSDKPayload({
      organization,
      environment,
      project: project || "",
    });
    if (cached) {
      let attributes: SDKAttributeSchema | undefined = undefined;
      let secureAttributeSalt: string | undefined = undefined;
      if (hashSecureAttributes) {
        const org = await getOrganizationById(organization);
        if (org && orgHasPremiumFeature(org, "hash-secure-attributes")) {
          secureAttributeSalt = org.settings?.secureAttributeSalt;
          attributes = org.settings?.attributeSchema;
        }
      }
      const { features, experiments } = cached.contents;
      return await getFeatureDefinitionsResponse({
        features,
        experiments: experiments || [],
        dateUpdated: cached.dateUpdated,
        encryptionKey,
        includeVisualExperiments,
        includeDraftExperiments,
        includeExperimentNames,
        attributes,
        secureAttributeSalt,
      });
    }
  } catch (e) {
    logger.error(e, "Failed to fetch SDK payload from cache");
  }

  const org = await getOrganizationById(organization);
  let attributes: SDKAttributeSchema | undefined = undefined;
  let secureAttributeSalt: string | undefined = undefined;
  if (hashSecureAttributes) {
    if (org && orgHasPremiumFeature(org, "hash-secure-attributes")) {
      secureAttributeSalt = org?.settings?.secureAttributeSalt;
      attributes = org.settings?.attributeSchema;
    }
  }
  if (!org) {
    return await getFeatureDefinitionsResponse({
      features: {},
      experiments: [],
      dateUpdated: null,
      encryptionKey,
      includeVisualExperiments,
      includeDraftExperiments,
      includeExperimentNames,
      attributes,
      secureAttributeSalt,
    });
  }

  // Generate the feature definitions
  const features = await getAllFeatures(organization, project);
  const groupMap = await getSavedGroupMap(org);

  const featureDefinitions = generatePayload({
    features,
    environment,
    groupMap,
  });

  const allVisualExperiments = await getAllVisualExperiments(
    organization,
    project
  );

  // Generate visual experiments
  const experimentsDefinitions = generateVisualExperimentsPayload({
    visualExperiments: allVisualExperiments,
    // environment: key.environment,
    groupMap,
  });

  // Cache in Mongo
  await updateSDKPayload({
    organization,
    project: project || "",
    environment,
    featureDefinitions,
    experimentsDefinitions,
  });

  return await getFeatureDefinitionsResponse({
    features: featureDefinitions,
    experiments: experimentsDefinitions,
    dateUpdated: new Date(),
    encryptionKey,
    includeVisualExperiments,
    includeDraftExperiments,
    includeExperimentNames,
    attributes,
    secureAttributeSalt,
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
): ApiFeature {
  const featureEnvironments: Record<string, ApiFeatureEnvironment> = {};
  const environments = getEnvironments(organization);
  environments.forEach((env) => {
    const defaultValue = feature.defaultValue;
    const envSettings = feature.environmentSettings?.[env.id];
    const enabled = !!envSettings?.enabled;
    const rules = (envSettings?.rules || []).map((rule) => ({
      ...rule,
      condition: rule.condition || "",
      enabled: !!rule.enabled,
    }));
    const definition = getFeatureDefinition({
      feature,
      groupMap,
      environment: env.id,
    });

    const draft: null | ApiFeatureEnvironment["draft"] = feature.draft?.active
      ? {
          enabled,
          defaultValue: feature.draft?.defaultValue ?? defaultValue,
          rules: (feature.draft?.rules?.[env.id] ?? rules).map((rule) => ({
            ...rule,
            condition: rule.condition || "",
            enabled: !!rule.enabled,
          })),
        }
      : null;
    if (draft) {
      const draftDefinition = getFeatureDefinition({
        feature,
        groupMap,
        environment: env.id,
        useDraft: true,
      });
      if (draftDefinition) {
        draft.definition = JSON.stringify(draftDefinition);
      }
    }

    featureEnvironments[env.id] = {
      defaultValue,
      enabled,
      rules,
    };
    if (draft) {
      featureEnvironments[env.id].draft = draft;
    }
    if (definition) {
      featureEnvironments[env.id].definition = JSON.stringify(definition);
    }
  });

  const featureRecord: ApiFeature = {
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

// Specific hashing entrypoint for Feature rules
export function applyFeatureHashing(
  features: Record<string, FeatureDefinition>,
  attributes: SDKAttributeSchema,
  salt: string
): Record<string, FeatureDefinition> {
  return Object.keys(features).reduce<Record<string, FeatureDefinition>>(
    (acc, key) => {
      const feature = features[key];
      if (feature?.rules) {
        feature.rules = feature.rules.map<FeatureDefinitionRule>((rule) => {
          if (rule?.condition) {
            rule.condition = hashStrings({
              obj: rule.condition,
              salt,
              attributes,
            });
          }
          return rule;
        });
      }
      acc[key] = feature;
      return acc;
    },
    {}
  );
}

// Specific hashing entrypoint for Experiment conditions
export function applyExperimentHashing(
  experiments: SDKExperiment[],
  attributes: SDKAttributeSchema,
  salt: string
): SDKExperiment[] {
  return experiments.map((experiment) => {
    if (experiment?.condition) {
      experiment.condition = hashStrings({
        obj: experiment.condition,
        salt,
        attributes,
      });
    }
    return experiment;
  });
}

interface hashStringsArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj: any;
  salt: string;
  attributes: SDKAttributeSchema;
  attribute?: SDKAttribute;
  doHash?: boolean;
}
// General recursive entrypoint for hashing secure attributes within a set of targeting conditions:
export function hashStrings({
  obj,
  salt,
  attributes,
  attribute,
  doHash = false,
}: hashStringsArgs): // eslint-disable-next-line @typescript-eslint/no-explicit-any
any {
  // Given an object of unknown type, determine whether to recurse into it or return it
  if (Array.isArray(obj)) {
    // loop over array elements, process them
    const newObj = [];
    for (let i = 0; i < obj.length; i++) {
      newObj[i] = processVal({
        obj: obj[i],
        attribute,
        doHash,
      });
    }
    return newObj;
  } else if (typeof obj === "object" && obj !== null) {
    // loop over object entries, process them
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newObj: any = {};
    for (const key in obj) {
      // check if a new attribute is referenced, and whether we need to hash it
      // otherwise, inherit the previous attribute and hashing status
      attribute = attributes.find((a) => a.property === key) ?? attribute;
      doHash = attribute
        ? !!(
            attribute?.datatype &&
            ["secureString", "secureString[]"].includes(
              attribute?.datatype ?? ""
            )
          )
        : doHash;

      newObj[key] = processVal({
        obj: obj[key],
        attribute,
        doHash,
      });
    }
    return newObj;
  } else {
    return obj;
  }

  // Helper function for processing a value. Will either hash it, recurse into it, or skip (return) it.
  function processVal({
    obj,
    attribute,
    doHash = false,
  }: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj: any;
    attribute?: SDKAttribute;
    doHash?: boolean;
  }): // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any {
    if (Array.isArray(obj)) {
      // recurse array
      return hashStrings({ obj, salt, attributes, attribute, doHash });
    } else if (typeof obj === "object" && obj !== null) {
      // recurse object
      return hashStrings({ obj, salt, attributes, attribute, doHash });
    } else if (typeof obj === "string") {
      // hash string value
      return doHash ? sha256(obj, salt) : obj;
    } else {
      return obj;
    }
  }
}

export function sha256(str: string, salt: string): string {
  return createHash("sha256")
    .update(salt + str)
    .digest("hex");
}
