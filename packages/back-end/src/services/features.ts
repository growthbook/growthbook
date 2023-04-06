import { webcrypto as crypto } from "node:crypto";
import uniqid from "uniqid";
import isEqual from "lodash/isEqual";
import { FeatureDefinition } from "../../types/api";
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
import { OrganizationInterface } from "../../types/organization";
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

export type VisualExperiment = {
  experiment: ExperimentInterface;
  visualChangeset: VisualChangesetInterface;
};

function generateVisualExperimentsPayload(
  visualExperiments: Array<VisualExperiment>,
  _environment: string,
  groupMap: GroupMap
): SDKExperiment[] {
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

    const featureDefinitions = generatePayload(
      projectFeatures,
      key.environment,
      groupMap
    );

    const experimentsDefinitions = generateVisualExperimentsPayload(
      projectExperiments,
      key.environment,
      groupMap
    );

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

  // After the SDK payloads are updated, fire any webhooks on the organization
  await queueWebhook(organization.id, payloadKeys, true);

  // Update any Proxy servers that are affected by this change
  await queueProxyUpdate(organization.id, payloadKeys);
}

async function getFeatureDefinitionsResponse(
  features: Record<string, FeatureDefinition>,
  experiments: SDKExperiment[],
  dateUpdated: Date | null,
  encryptionKey?: string,
  includeVisualExperiments?: boolean,
  includeDraftExperiments?: boolean
) {
  if (!includeDraftExperiments) {
    experiments = experiments?.filter((e) => e.status !== "draft") || [];
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

export async function getFeatureDefinitions(
  organization: string,
  environment: string = "production",
  project?: string,
  encryptionKey?: string,
  includeVisualExperiments?: boolean,
  includeDraftExperiments?: boolean
): Promise<{
  features: Record<string, FeatureDefinition>;
  experiments?: SDKExperiment[];
  dateUpdated: Date | null;
  encryptedFeatures?: string;
  encryptedExperiments?: string;
}> {
  // Return cached payload from Mongo if exists
  try {
    const cached = await getSDKPayload({
      organization,
      environment,
      project: project || "",
    });
    if (cached) {
      const { features, experiments } = cached.contents;
      return await getFeatureDefinitionsResponse(
        features,
        experiments || [],
        cached.dateUpdated,
        encryptionKey,
        includeVisualExperiments,
        includeDraftExperiments
      );
    }
  } catch (e) {
    logger.error(e, "Failed to fetch SDK payload from cache");
  }

  const org = await getOrganizationById(organization);
  if (!org) {
    return await getFeatureDefinitionsResponse(
      {},
      [],
      null,
      encryptionKey,
      includeVisualExperiments,
      includeDraftExperiments
    );
  }

  // Generate the feature definitions
  const features = await getAllFeatures(organization, project);
  const groupMap = await getSavedGroupMap(org);
  const featureDefinitions = generatePayload(features, environment, groupMap);

  const allVisualExperiments = await getAllVisualExperiments(
    organization,
    project
  );

  // Generate visual experiments
  const experimentsDefinitions = generateVisualExperimentsPayload(
    allVisualExperiments,
    environment,
    groupMap
  );

  // Cache in Mongo
  await updateSDKPayload({
    organization,
    project: project || "",
    environment,
    featureDefinitions,
    experimentsDefinitions,
  });

  return await getFeatureDefinitionsResponse(
    featureDefinitions,
    experimentsDefinitions,
    new Date(),
    encryptionKey,
    includeVisualExperiments,
    includeDraftExperiments
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
