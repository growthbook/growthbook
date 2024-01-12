import { webcrypto as crypto } from "node:crypto";
import { createHash } from "crypto";
import uniqid from "uniqid";
import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
import { orgHasPremiumFeature } from "enterprise";
import {
  FeatureRule as FeatureDefinitionRule,
  AutoExperiment,
  GrowthBook,
} from "@growthbook/growthbook";
import { validateCondition, validateFeatureValue } from "shared/util";
import { scrubFeatures, SDKCapability } from "shared/sdk-versioning";
import {
  AutoExperimentWithProject,
  FeatureDefinition,
  FeatureDefinitionWithProject,
} from "../../types/api";
import {
  FeatureDraftChanges,
  FeatureEnvironment,
  FeatureInterface,
  FeatureRule,
  ForceRule,
  RolloutRule,
  FeatureTestResult,
  ExperimentRefRule,
} from "../../types/feature";
import { getAllFeatures } from "../models/FeatureModel";
import {
  getAllPayloadExperiments,
  getAllVisualExperiments,
} from "../models/ExperimentModel";
import { getFeatureDefinition, getParsedCondition } from "../util/features";
import { getAllSavedGroups } from "../models/SavedGroupModel";
import {
  Environment,
  OrganizationInterface,
  SDKAttribute,
  SDKAttributeSchema,
} from "../../types/organization";
import { getSDKPayload, updateSDKPayload } from "../models/SdkPayloadModel";
import { logger } from "../util/logger";
import { promiseAllChunks } from "../util/promise";
import { queueWebhook } from "../jobs/webhooks";
import { GroupMap } from "../../types/saved-group";
import { SDKPayloadKey } from "../../types/sdk-payload";
import { queueProxyUpdate } from "../jobs/proxyUpdate";
import { ApiFeature, ApiFeatureEnvironment } from "../../types/openapi";
import { ExperimentInterface, ExperimentPhase } from "../../types/experiment";
import { VisualChangesetInterface } from "../../types/visual-changeset";
import {
  getSurrogateKeysFromEnvironments,
  purgeCDNCache,
} from "../util/cdn.util";
import {
  ApiFeatureEnvSettings,
  ApiFeatureEnvSettingsRules,
} from "../api/features/postFeature";
import { ArchetypeAttributeValues } from "../../types/archetype";
import { FeatureRevisionInterface } from "../../types/feature-revision";
import { getEnvironmentIdsFromOrg, getOrganizationById } from "./organizations";

export type AttributeMap = Map<string, string>;

function generatePayload({
  features,
  experimentMap,
  environment,
  groupMap,
}: {
  features: FeatureInterface[];
  experimentMap: Map<string, ExperimentInterface>;
  environment: string;
  groupMap: GroupMap;
}): Record<string, FeatureDefinition> {
  const defs: Record<string, FeatureDefinition> = {};
  features.forEach((feature) => {
    const def = getFeatureDefinition({
      feature,
      environment,
      groupMap,
      experimentMap,
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
}): AutoExperimentWithProject[] {
  const isValidSDKExperiment = (
    e: AutoExperimentWithProject | null
  ): e is AutoExperimentWithProject => !!e;
  const sdkExperiments: Array<AutoExperimentWithProject | null> = visualExperiments.map(
    ({ experiment: e, visualChangeset: v }) => {
      if (e.status === "stopped" && e.excludeFromPayload) return null;

      const phase: ExperimentPhase | null = e.phases.slice(-1)?.[0] ?? null;
      const forcedVariation =
        e.status === "stopped" && e.releasedVariationId
          ? e.variations.find((v) => v.id === e.releasedVariationId)
          : null;

      const condition = getParsedCondition(
        groupMap,
        phase?.condition,
        phase?.savedGroups
      );

      if (!phase) return null;

      const exp: AutoExperimentWithProject = {
        key: e.trackingKey,
        status: e.status,
        project: e.project,
        variations: v.visualChanges.map((vc) => ({
          css: vc.css,
          js: vc.js || "",
          domMutations: vc.domMutations,
        })) as AutoExperimentWithProject["variations"],
        hashVersion: e.hashVersion,
        hashAttribute: e.hashAttribute,
        fallbackAttribute: e.fallbackAttribute,
        disableStickyBucketing: e.disableStickyBucketing,
        bucketVersion: e.bucketVersion,
        minBucketVersion: e.minBucketVersion,
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

      return exp;
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
      let values: (string | number)[] = [];
      if (group.type === "list" && group.attributeKey && group.values) {
        const attributeType = attributeMap?.get(group.attributeKey);
        values = getGroupValues(group.values, attributeType);
      }
      return [
        group.id,
        {
          ...group,
          values,
        },
      ];
    })
  );

  return groupMap;
}

export async function refreshSDKPayloadCache(
  organization: OrganizationInterface,
  payloadKeys: SDKPayloadKey[],
  allFeatures: FeatureInterface[] | null = null,
  experimentMap?: Map<string, ExperimentInterface>,
  skipRefreshForProject?: string
) {
  logger.debug(
    `Refreshing SDK Payloads for ${organization.id}: ${JSON.stringify(
      payloadKeys
    )}`
  );

  // Ignore any old environments which don't exist anymore
  const allowedEnvs = new Set(getEnvironmentIdsFromOrg(organization));
  payloadKeys = payloadKeys.filter((k) => allowedEnvs.has(k.environment));

  // Remove any projects to skip
  if (skipRefreshForProject) {
    payloadKeys = payloadKeys.filter(
      (k) => k.project !== skipRefreshForProject
    );
  }

  // If no environments are affected, we don't need to update anything
  if (!payloadKeys.length) {
    logger.debug("Skipping SDK Payload refresh - no environments affected");
    return;
  }

  experimentMap =
    experimentMap || (await getAllPayloadExperiments(organization.id));
  const groupMap = await getSavedGroupMap(organization);
  allFeatures = allFeatures || (await getAllFeatures(organization.id));
  const allVisualExperiments = await getAllVisualExperiments(
    organization.id,
    experimentMap
  );

  // For each affected environment, generate a new SDK payload and update the cache
  const environments = Array.from(
    new Set(payloadKeys.map((k) => k.environment))
  );

  const promises: (() => Promise<void>)[] = [];
  for (const env of environments) {
    const featureDefinitions = generatePayload({
      features: allFeatures,
      environment: env,
      groupMap,
      experimentMap,
    });

    const experimentsDefinitions = generateVisualExperimentsPayload({
      visualExperiments: allVisualExperiments,
      // environment: key.environment,
      groupMap,
    });

    promises.push(async () => {
      logger.debug(`Updating SDK Payload for ${organization.id} ${env}`);
      await updateSDKPayload({
        organization: organization.id,
        environment: env,
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
  // Only purge the specific payloads that are affected
  const surrogateKeys = getSurrogateKeysFromEnvironments(organization.id, [
    ...environments,
  ]);

  await purgeCDNCache(organization.id, surrogateKeys);

  // After the SDK payloads are updated, fire any webhooks on the organization
  await queueWebhook(organization.id, payloadKeys, true);

  // Update any Proxy servers that are affected by this change
  await queueProxyUpdate(organization.id, payloadKeys);
}

export type FeatureDefinitionsResponseArgs = {
  features: Record<string, FeatureDefinitionWithProject>;
  experiments: AutoExperimentWithProject[];
  dateUpdated: Date | null;
  encryptionKey?: string;
  includeVisualExperiments?: boolean;
  includeDraftExperiments?: boolean;
  includeExperimentNames?: boolean;
  attributes?: SDKAttributeSchema;
  secureAttributeSalt?: string;
  projects: string[];
  capabilities: SDKCapability[];
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
  projects,
  capabilities,
}: FeatureDefinitionsResponseArgs) {
  if (!includeDraftExperiments) {
    experiments = experiments?.filter((e) => e.status !== "draft") || [];
  }

  // If experiment/variation names should be removed from the payload
  if (!includeExperimentNames) {
    // Remove names from visual editor experiments
    experiments = experiments?.map((exp) => {
      return {
        ...omit(exp, ["name", "meta"]),
        meta: exp.meta ? exp.meta.map((m) => omit(m, ["name"])) : undefined,
      };
    });

    // Remove names from every feature rule
    for (const k in features) {
      if (features[k]?.rules) {
        features[k].rules = features[k].rules?.map((rule) => {
          return {
            ...omit(rule, ["name", "meta"]),
            meta: rule.meta
              ? rule.meta.map((m) => omit(m, ["name"]))
              : undefined,
          };
        });
      }
    }
  }

  // Filter list of features/experiments to the selected projects
  if (projects && projects.length > 0) {
    experiments = experiments.filter((exp) =>
      projects.includes(exp.project || "")
    );
    features = Object.fromEntries(
      Object.entries(features).filter(([_, feature]) =>
        projects.includes(feature.project || "")
      )
    );
  }

  // Remove `project` from all features/experiments
  features = Object.fromEntries(
    Object.entries(features).map(([key, feature]) => [
      key,
      omit(feature, ["project"]),
    ])
  );
  experiments = experiments.map((exp) => omit(exp, ["project"]));

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

  features = scrubFeatures(features, capabilities);

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
  capabilities: SDKCapability[];
  environment?: string;
  projects?: string[];
  encryptionKey?: string;
  includeVisualExperiments?: boolean;
  includeDraftExperiments?: boolean;
  includeExperimentNames?: boolean;
  hashSecureAttributes?: boolean;
};
export type FeatureDefinitionSDKPayload = {
  features: Record<string, FeatureDefinition>;
  experiments?: AutoExperiment[];
  dateUpdated: Date | null;
  encryptedFeatures?: string;
  encryptedExperiments?: string;
};

export async function getFeatureDefinitions({
  organization,
  capabilities,
  environment = "production",
  projects,
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
        projects: projects || [],
        capabilities,
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
      projects: projects || [],
      capabilities,
    });
  }

  // Generate the feature definitions
  const features = await getAllFeatures(organization);
  const groupMap = await getSavedGroupMap(org);
  const experimentMap = await getAllPayloadExperiments(organization);

  const featureDefinitions = generatePayload({
    features,
    environment,
    groupMap,
    experimentMap,
  });

  const allVisualExperiments = await getAllVisualExperiments(
    organization,
    experimentMap
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
    projects: projects || [],
    capabilities,
  });
}

export function evaluateFeature({
  feature,
  attributes,
  environments,
  groupMap,
  experimentMap,
  revision,
}: {
  feature: FeatureInterface;
  attributes: ArchetypeAttributeValues;
  groupMap: GroupMap;
  experimentMap: Map<string, ExperimentInterface>;
  environments: Environment[];
  revision: FeatureRevisionInterface;
}) {
  const results: FeatureTestResult[] = [];

  // change the NODE ENV so that we can get the debug log information:
  let switchEnv = false;
  if (process.env.NODE_ENV === "production") {
    process.env.NODE_ENV = "development";
    switchEnv = true;
  }
  // I could loop through the feature's defined environments, but if environments change in the org,
  // the values in the feature will be wrong.
  environments.forEach((env) => {
    const thisEnvResult: FeatureTestResult = {
      env: env.id,
      result: null,
      enabled: false,
      defaultValue: revision.defaultValue,
    };
    const settings = feature.environmentSettings[env.id] ?? null;
    if (settings) {
      thisEnvResult.enabled = settings.enabled;
      const definition = getFeatureDefinition({
        feature,
        groupMap,
        experimentMap,
        environment: env.id,
        revision,
        returnRuleId: true,
      });
      if (definition) {
        thisEnvResult.featureDefinition = definition;
        const log: [string, never][] = [];
        const gb = new GrowthBook({
          features: {
            [feature.id]: definition,
          },
          attributes: attributes,
          log: (msg: string, ctx: never) => {
            log.push([msg, ctx]);
          },
        });
        gb.debug = true;
        thisEnvResult.result = gb.evalFeature(feature.id);
        thisEnvResult.log = log;
        gb.destroy();
      }
    }
    results.push(thisEnvResult);
  });
  if (switchEnv) {
    // change the NODE ENV back
    process.env.NODE_ENV = "production";
  }
  return results;
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

export function getApiFeatureObj({
  feature,
  organization,
  groupMap,
  experimentMap,
}: {
  feature: FeatureInterface;
  organization: OrganizationInterface;
  groupMap: GroupMap;
  experimentMap: Map<string, ExperimentInterface>;
}): ApiFeature {
  const defaultValue = feature.defaultValue;
  const featureEnvironments: Record<string, ApiFeatureEnvironment> = {};
  const environments = getEnvironmentIdsFromOrg(organization);
  environments.forEach((env) => {
    const envSettings = feature.environmentSettings?.[env];
    const enabled = !!envSettings?.enabled;
    const rules = (envSettings?.rules || []).map((rule) => ({
      ...rule,
      coverage:
        rule.type === "rollout" || rule.type === "experiment"
          ? rule.coverage ?? 1
          : 1,
      condition: rule.condition || "",
      savedGroupTargeting: (rule.savedGroups || []).map((s) => ({
        matchType: s.match,
        savedGroups: s.ids,
      })),
      enabled: !!rule.enabled,
    }));
    const definition = getFeatureDefinition({
      feature,
      groupMap,
      experimentMap,
      environment: env,
    });

    featureEnvironments[env] = {
      enabled,
      defaultValue,
      rules,
    };
    if (definition) {
      featureEnvironments[env].definition = JSON.stringify(definition);
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
      comment: "",
      date: feature.dateCreated.toISOString(),
      publishedBy: "",
      version: feature.version,
    },
  };

  return featureRecord;
}

export function getNextScheduledUpdate(
  envSettings: Record<string, FeatureEnvironment>,
  environments: string[]
): Date | null {
  if (!envSettings) {
    return null;
  }

  const dates: string[] = [];

  environments.forEach((env) => {
    const rules = envSettings[env]?.rules;

    if (!rules) return;

    rules.forEach((rule: FeatureRule) => {
      if (rule?.scheduleRules) {
        rule.scheduleRules.forEach((scheduleRule) => {
          if (scheduleRule.timestamp !== null) {
            dates.push(scheduleRule.timestamp);
          }
        });
      }
    });
  });

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
  experiments: AutoExperiment[],
  attributes: SDKAttributeSchema,
  salt: string
): AutoExperiment[] {
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

const fromApiEnvSettingsRulesToFeatureEnvSettingsRules = (
  feature: FeatureInterface,
  rules: ApiFeatureEnvSettingsRules
): FeatureInterface["environmentSettings"][string]["rules"] =>
  rules.map((r) => {
    const conditionRes = validateCondition(r.condition);
    if (!conditionRes.success) {
      throw new Error(
        "Invalid targeting condition JSON: " + conditionRes.error
      );
    }

    if (r.type === "experiment-ref") {
      const experimentRule: ExperimentRefRule = {
        // missing id will be filled in by addIdsToRules
        id: r.id ?? "",
        type: r.type,
        enabled: r.enabled != null ? r.enabled : true,
        description: r.description ?? "",
        experimentId: r.experimentId,
        variations: r.variations.map((v) => ({
          variationId: v.variationId,
          value: validateFeatureValue(feature, v.value),
        })),
      };
      return experimentRule;
    } else if (r.type === "force") {
      const forceRule: ForceRule = {
        // missing id will be filled in by addIdsToRules
        id: r.id ?? "",
        type: r.type,
        description: r.description ?? "",
        value: validateFeatureValue(feature, r.value),
        condition: r.condition,
        savedGroups: (r.savedGroupTargeting || []).map((s) => ({
          ids: s.savedGroups,
          match: s.matchType,
        })),
        enabled: r.enabled != null ? r.enabled : true,
      };
      return forceRule;
    }
    const rolloutRule: RolloutRule = {
      // missing id will be filled in by addIdsToRules
      id: r.id ?? "",
      type: r.type,
      coverage: r.coverage,
      description: r.description ?? "",
      hashAttribute: r.hashAttribute,
      value: validateFeatureValue(feature, r.value),
      condition: r.condition,
      savedGroups: (r.savedGroupTargeting || []).map((s) => ({
        ids: s.savedGroups,
        match: s.matchType,
      })),
      enabled: r.enabled != null ? r.enabled : true,
    };
    return rolloutRule;
  });

export const createInterfaceEnvSettingsFromApiEnvSettings = (
  feature: FeatureInterface,
  baseEnvs: Environment[],
  incomingEnvs: ApiFeatureEnvSettings
): FeatureInterface["environmentSettings"] =>
  baseEnvs.reduce(
    (acc, e) => ({
      ...acc,
      [e.id]: {
        enabled: incomingEnvs?.[e.id]?.enabled ?? !!e.defaultState,
        rules: incomingEnvs?.[e.id]?.rules
          ? fromApiEnvSettingsRulesToFeatureEnvSettingsRules(
              feature,
              incomingEnvs[e.id].rules
            )
          : [],
      },
    }),
    {} as Record<string, FeatureEnvironment>
  );

export const updateInterfaceEnvSettingsFromApiEnvSettings = (
  feature: FeatureInterface,
  incomingEnvs: ApiFeatureEnvSettings
): FeatureInterface["environmentSettings"] => {
  const existing = feature.environmentSettings;
  return Object.keys(incomingEnvs).reduce((acc, k) => {
    return {
      ...acc,
      [k]: {
        enabled: incomingEnvs[k].enabled ?? existing[k].enabled,
        rules: incomingEnvs[k].rules
          ? fromApiEnvSettingsRulesToFeatureEnvSettingsRules(
              feature,
              incomingEnvs[k].rules
            )
          : existing[k].rules,
      },
    };
  }, existing);
};
