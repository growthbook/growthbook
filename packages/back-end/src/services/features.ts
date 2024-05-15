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
  ParentConditionInterface,
} from "@growthbook/growthbook";
import {
  evalDeterministicPrereqValue,
  evaluatePrerequisiteState,
  PrerequisiteStateResult,
  validateCondition,
  validateFeatureValue,
} from "shared/util";
import {
  scrubExperiments,
  scrubFeatures,
  SDKCapability,
} from "shared/sdk-versioning";
import cloneDeep from "lodash/cloneDeep";
import {
  ApiReqContext,
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
  FeaturePrerequisite,
} from "../../types/feature";
import { getAllFeatures } from "../models/FeatureModel";
import {
  getAllPayloadExperiments,
  getAllURLRedirectExperiments,
  getAllVisualExperiments,
} from "../models/ExperimentModel";
import { getFeatureDefinition, getParsedCondition } from "../util/features";
import { getAllSavedGroups } from "../models/SavedGroupModel";
import {
  Environment,
  OrganizationInterface,
  ReqContext,
  SDKAttribute,
  SDKAttributeSchema,
} from "../../types/organization";
import { getSDKPayload, updateSDKPayload } from "../models/SdkPayloadModel";
import { logger } from "../util/logger";
import { promiseAllChunks } from "../util/promise";
import { GroupMap } from "../../types/saved-group";
import { SDKPayloadKey } from "../../types/sdk-payload";
import { ApiFeature, ApiFeatureEnvironment } from "../../types/openapi";
import { ExperimentInterface, ExperimentPhase } from "../../types/experiment";
import { VisualChangesetInterface } from "../../types/visual-changeset";
import {
  ApiFeatureEnvSettings,
  ApiFeatureEnvSettingsRules,
} from "../api/features/postFeature";
import { ArchetypeAttributeValues } from "../../types/archetype";
import { FeatureRevisionInterface } from "../../types/feature-revision";
import { triggerWebhookJobs } from "../jobs/updateAllJobs";
import { URLRedirectInterface } from "../../types/url-redirect";
import {
  getContextForAgendaJobByOrgObject,
  getEnvironmentIdsFromOrg,
  getOrganizationById,
} from "./organizations";

export type AttributeMap = Map<string, string>;

export function generateFeaturesPayload({
  features,
  experimentMap,
  environment,
  groupMap,
  prereqStateCache = {},
}: {
  features: FeatureInterface[];
  experimentMap: Map<string, ExperimentInterface>;
  environment: string;
  groupMap: GroupMap;
  prereqStateCache?: Record<string, Record<string, PrerequisiteStateResult>>;
}): Record<string, FeatureDefinition> {
  prereqStateCache[environment] = prereqStateCache[environment] || {};

  const defs: Record<string, FeatureDefinition> = {};
  const newFeatures = reduceFeaturesWithPrerequisites(
    features,
    environment,
    prereqStateCache
  );
  newFeatures.forEach((feature) => {
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
  type: "visual";
  experiment: ExperimentInterface;
  visualChangeset: VisualChangesetInterface;
};
export type URLRedirectExperiment = {
  type: "redirect";
  experiment: ExperimentInterface;
  urlRedirect: URLRedirectInterface;
};

export function generateAutoExperimentsPayload({
  visualExperiments,
  urlRedirectExperiments,
  groupMap,
  features,
  environment,
  prereqStateCache = {},
}: {
  visualExperiments: VisualExperiment[];
  urlRedirectExperiments: URLRedirectExperiment[];
  groupMap: GroupMap;
  features: FeatureInterface[];
  environment: string;
  prereqStateCache?: Record<string, Record<string, PrerequisiteStateResult>>;
}): AutoExperimentWithProject[] {
  prereqStateCache[environment] = prereqStateCache[environment] || {};

  const isValidSDKExperiment = (
    e: AutoExperimentWithProject | null
  ): e is AutoExperimentWithProject => !!e;

  const newVisualExperiments = reduceExperimentsWithPrerequisites(
    visualExperiments,
    features,
    environment,
    prereqStateCache
  );

  const newURLRedirectExperiments = reduceExperimentsWithPrerequisites(
    urlRedirectExperiments,
    features,
    environment,
    prereqStateCache
  );

  const sortedVisualExperiments = [
    ...newURLRedirectExperiments,
    ...newVisualExperiments,
  ];

  const sdkExperiments: Array<AutoExperimentWithProject | null> = sortedVisualExperiments.map(
    (data) => {
      const { experiment: e } = data;
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

      const prerequisites = (phase?.prerequisites ?? [])
        ?.map((p) => {
          const condition = getParsedCondition(groupMap, p.condition);
          if (!condition) return null;
          return {
            id: p.id,
            condition,
          };
        })
        .filter(Boolean) as ParentConditionInterface[];

      if (!phase) return null;

      const exp: AutoExperimentWithProject = {
        key: e.trackingKey,
        status: e.status,
        project: e.project,
        variations: e.variations.map((v) => {
          if (data.type === "redirect") {
            const match = data.urlRedirect.destinationURLs.find(
              (d) => d.variation === v.id
            );
            return {
              urlRedirect: match?.url || "",
            };
          }

          const match = data.visualChangeset.visualChanges.find(
            (vc) => vc.variation === v.id
          );
          return {
            css: match?.css || "",
            js: match?.js || "",
            domMutations: match?.domMutations || [],
          };
        }) as AutoExperimentWithProject["variations"],
        hashVersion: e.hashVersion,
        hashAttribute: e.hashAttribute,
        fallbackAttribute: e.fallbackAttribute,
        disableStickyBucketing: e.disableStickyBucketing,
        bucketVersion: e.bucketVersion,
        minBucketVersion: e.minBucketVersion,
        urlPatterns:
          data.type === "redirect"
            ? [
                {
                  include: true,
                  pattern: data.urlRedirect.urlPattern,
                  type: "simple",
                },
              ]
            : data.visualChangeset.urlPatterns,
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
        changeType: data.type,
      };

      if (prerequisites.length) {
        exp.parentConditions = prerequisites;
      }

      if (data.type === "redirect" && data.urlRedirect.persistQueryString) {
        exp.persistQueryString = true;
      }

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
  baseContext: ReqContext | ApiReqContext,
  payloadKeys: SDKPayloadKey[],
  allFeatures: FeatureInterface[] | null = null,
  experimentMap?: Map<string, ExperimentInterface>,
  skipRefreshForProject?: string
) {
  // This is a background job, so switch to using a background context
  // This is required so that we have full read access to the entire org's data
  const context = getContextForAgendaJobByOrgObject(baseContext.org);

  logger.debug(
    `Refreshing SDK Payloads for ${context.org.id}: ${JSON.stringify(
      payloadKeys
    )}`
  );

  // Ignore any old environments which don't exist anymore
  const allowedEnvs = new Set(getEnvironmentIdsFromOrg(context.org));
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

  experimentMap = experimentMap || (await getAllPayloadExperiments(context));
  const groupMap = await getSavedGroupMap(context.org);
  allFeatures = allFeatures || (await getAllFeatures(context));
  const allVisualExperiments = await getAllVisualExperiments(
    context,
    experimentMap
  );
  const allURLRedirectExperiments = await getAllURLRedirectExperiments(
    context,
    experimentMap
  );

  // For each affected environment, generate a new SDK payload and update the cache
  const environments = Array.from(
    new Set(payloadKeys.map((k) => k.environment))
  );

  const prereqStateCache: Record<
    string,
    Record<string, PrerequisiteStateResult>
  > = {};

  const promises: (() => Promise<void>)[] = [];
  for (const environment of environments) {
    const featureDefinitions = generateFeaturesPayload({
      features: allFeatures,
      environment: environment,
      groupMap,
      experimentMap,
      prereqStateCache,
    });

    const experimentsDefinitions = generateAutoExperimentsPayload({
      visualExperiments: allVisualExperiments,
      urlRedirectExperiments: allURLRedirectExperiments,
      groupMap,
      features: allFeatures,
      environment,
      prereqStateCache,
    });

    promises.push(async () => {
      logger.debug(`Updating SDK Payload for ${context.org.id} ${environment}`);
      await updateSDKPayload({
        organization: context.org.id,
        environment: environment,
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

  triggerWebhookJobs(context, payloadKeys, environments, true).catch((e) => {
    logger.error(e, "Error triggering webhook jobs");
  });
}

export type FeatureDefinitionsResponseArgs = {
  features: Record<string, FeatureDefinitionWithProject>;
  experiments: AutoExperimentWithProject[];
  dateUpdated: Date | null;
  encryptionKey?: string;
  includeVisualExperiments?: boolean;
  includeDraftExperiments?: boolean;
  includeExperimentNames?: boolean;
  includeRedirectExperiments?: boolean;
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
  includeRedirectExperiments,
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
  experiments = scrubExperiments(experiments, capabilities);

  const includeAutoExperiments =
    !!includeRedirectExperiments || !!includeVisualExperiments;

  if (includeAutoExperiments) {
    if (!includeRedirectExperiments) {
      experiments = experiments.filter((e) => e.changeType !== "redirect");
    }
    if (!includeVisualExperiments) {
      experiments = experiments.filter((e) => e.changeType === "redirect");
    }
  }

  experiments = experiments.map((exp) => omit(exp, ["changeType"]));

  if (!encryptionKey) {
    return {
      features,
      ...(includeAutoExperiments && { experiments }),
      dateUpdated,
    };
  }

  const encryptedFeatures = await encrypt(
    JSON.stringify(features),
    encryptionKey
  );
  const encryptedExperiments = includeAutoExperiments
    ? await encrypt(JSON.stringify(experiments || []), encryptionKey)
    : undefined;

  return {
    features: {},
    ...(includeAutoExperiments && { experiments: [] }),
    dateUpdated,
    encryptedFeatures,
    ...(includeAutoExperiments && { encryptedExperiments }),
  };
}

export type FeatureDefinitionArgs = {
  context: ReqContext | ApiReqContext;
  capabilities: SDKCapability[];
  environment?: string;
  projects?: string[] | null;
  encryptionKey?: string;
  includeVisualExperiments?: boolean;
  includeDraftExperiments?: boolean;
  includeExperimentNames?: boolean;
  includeRedirectExperiments?: boolean;
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
  context,
  capabilities,
  environment = "production",
  projects,
  encryptionKey,
  includeVisualExperiments,
  includeDraftExperiments,
  includeExperimentNames,
  includeRedirectExperiments,
  hashSecureAttributes,
}: FeatureDefinitionArgs): Promise<FeatureDefinitionSDKPayload> {
  // Return cached payload from Mongo if exists
  try {
    const cached = await getSDKPayload({
      organization: context.org.id,
      environment,
    });
    if (cached) {
      if (projects === null) {
        // null projects have nothing in the payload. They result from environment project scrubbing.
        return {
          features: {},
          experiments: [],
          dateUpdated: cached.dateUpdated,
        };
      }
      let attributes: SDKAttributeSchema | undefined = undefined;
      let secureAttributeSalt: string | undefined = undefined;
      if (hashSecureAttributes) {
        const org = await getOrganizationById(context.org.id);
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
        includeRedirectExperiments,
        attributes,
        secureAttributeSalt,
        projects: projects || [],
        capabilities,
      });
    }
  } catch (e) {
    logger.error(e, "Failed to fetch SDK payload from cache");
  }

  const org = await getOrganizationById(context.org.id);
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
      includeRedirectExperiments,
      attributes,
      secureAttributeSalt,
      projects: projects || [],
      capabilities,
    });
  }

  // Generate the feature definitions
  const features = await getAllFeatures(context);
  const groupMap = await getSavedGroupMap(org);
  const experimentMap = await getAllPayloadExperiments(context);

  const prereqStateCache: Record<
    string,
    Record<string, PrerequisiteStateResult>
  > = {};

  const featureDefinitions = generateFeaturesPayload({
    features,
    environment,
    groupMap,
    experimentMap,
    prereqStateCache,
  });

  const allVisualExperiments = await getAllVisualExperiments(
    context,
    experimentMap
  );
  const allURLRedirectExperiments = await getAllURLRedirectExperiments(
    context,
    experimentMap
  );

  // Generate visual experiments
  const experimentsDefinitions = generateAutoExperimentsPayload({
    visualExperiments: allVisualExperiments,
    urlRedirectExperiments: allURLRedirectExperiments,
    groupMap,
    features,
    environment,
    prereqStateCache,
  });

  // Cache in Mongo
  await updateSDKPayload({
    organization: context.org.id,
    environment,
    featureDefinitions,
    experimentsDefinitions,
  });

  if (projects === null) {
    // null projects have nothing in the payload. They result from environment project scrubbing.
    return {
      features: {},
      experiments: [],
      dateUpdated: new Date(),
    };
  }

  return await getFeatureDefinitionsResponse({
    features: featureDefinitions,
    experiments: experimentsDefinitions,
    dateUpdated: new Date(),
    encryptionKey,
    includeVisualExperiments,
    includeDraftExperiments,
    includeExperimentNames,
    includeRedirectExperiments,
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
  scrubPrerequisites = true,
  skipRulesWithPrerequisites = true,
}: {
  feature: FeatureInterface;
  attributes: ArchetypeAttributeValues;
  groupMap: GroupMap;
  experimentMap: Map<string, ExperimentInterface>;
  environments: Environment[];
  revision: FeatureRevisionInterface;
  scrubPrerequisites?: boolean;
  skipRulesWithPrerequisites?: boolean;
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
        // Prerequisite scrubbing:
        const rulesWithPrereqs: FeatureDefinitionRule[] = [];
        if (scrubPrerequisites) {
          definition.rules = definition.rules
            ? (definition?.rules
                ?.map((rule) => {
                  if (rule?.parentConditions?.length) {
                    rulesWithPrereqs.push(rule);
                    if (rule.parentConditions.some((pc) => !!pc.gate)) {
                      return null;
                    }
                    if (skipRulesWithPrerequisites) {
                      // make rule invalid so it is skipped
                      delete rule.force;
                      delete rule.variations;
                    }
                    delete rule.parentConditions;
                  }
                  return rule;
                })
                .filter(Boolean) as FeatureDefinitionRule[])
            : undefined;
        }

        thisEnvResult.featureDefinition = definition;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const log: [string, any][] = [];
        const gb = new GrowthBook({
          features: {
            [feature.id]: definition,
          },
          attributes: attributes,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          log: (msg: string, ctx: any) => {
            const ruleId = ctx?.rule?.id ?? null;
            if (ruleId && rulesWithPrereqs.find((r) => r.id === ruleId)) {
              if (skipRulesWithPrerequisites) {
                msg = "Skip rule with prerequisite targeting";
              } else {
                msg += " (prerequisite targeting passed)";
              }
            }
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

// Only keep features that are "on" or "conditional". For "on" features, remove any top level prerequisites
export const reduceFeaturesWithPrerequisites = (
  features: FeatureInterface[],
  environment: string,
  prereqStateCache: Record<string, Record<string, PrerequisiteStateResult>> = {}
): FeatureInterface[] => {
  prereqStateCache[environment] = prereqStateCache[environment] || {};

  const newFeatures: FeatureInterface[] = [];

  const featuresMap = new Map(features.map((f) => [f.id, f]));

  // block "always off" features, or remove "always on" prereqs
  for (const feature of features) {
    const newFeature = cloneDeep(feature);
    let removeFeature = false;

    const newPrerequisites: FeaturePrerequisite[] = [];
    for (const prereq of newFeature.prerequisites || []) {
      let state: PrerequisiteStateResult = {
        state: "deterministic",
        value: null,
      };
      if (prereqStateCache[environment][prereq.id]) {
        state = prereqStateCache[environment][prereq.id];
      } else {
        const prereqFeature = featuresMap.get(prereq.id);
        if (prereqFeature) {
          state = evaluatePrerequisiteState(
            prereqFeature,
            featuresMap,
            environment,
            undefined,
            true
          );
        }
        prereqStateCache[environment][prereq.id] = state;
      }

      switch (state.state) {
        case "conditional":
          // keep the feature and the prerequisite
          newPrerequisites.push(prereq);
          break;
        case "cyclic":
          removeFeature = true;
          break;
        case "deterministic": {
          const evaled = evalDeterministicPrereqValue(
            state.value ?? null,
            prereq.condition
          );
          if (evaled === "fail") {
            removeFeature = true;
          }
          break;
        }
      }
    }
    if (!removeFeature) {
      newFeature.prerequisites = newPrerequisites;
      newFeatures.push(newFeature);
    }
  }

  // block "always off" rules, or reduce "always on" rules
  for (let i = 0; i < newFeatures.length; i++) {
    const feature = newFeatures[i];
    if (!feature.environmentSettings[environment]?.rules) continue;

    const newFeatureRules: FeatureRule[] = [];

    for (
      let i = 0;
      i < feature.environmentSettings[environment].rules.length;
      i++
    ) {
      const rule = feature.environmentSettings[environment].rules[i];
      const {
        removeRule,
        newPrerequisites,
      } = getInlinePrerequisitesReductionInfo(
        rule.prerequisites || [],
        featuresMap,
        environment,
        prereqStateCache
      );
      if (!removeRule) {
        rule.prerequisites = newPrerequisites;
        newFeatureRules.push(rule);
      }
    }
    newFeatures[i].environmentSettings[environment].rules = newFeatureRules;
  }

  return newFeatures;
};

export const reduceExperimentsWithPrerequisites = <
  T extends { experiment: ExperimentInterface }
>(
  experiments: T[],
  features: FeatureInterface[],
  environment: string,
  prereqStateCache: Record<string, Record<string, PrerequisiteStateResult>> = {}
): T[] => {
  prereqStateCache[environment] = prereqStateCache[environment] || {};

  const featuresMap = new Map(features.map((f) => [f.id, f]));

  const newExperiments: T[] = [];
  for (const data of experiments) {
    const phaseIndex = data.experiment.phases.length - 1;
    const phase: ExperimentPhase | null =
      data.experiment.phases?.[phaseIndex] ?? null;
    if (!phase) continue;
    const newData = cloneDeep(data);

    const {
      removeRule,
      newPrerequisites,
    } = getInlinePrerequisitesReductionInfo(
      phase.prerequisites || [],
      featuresMap,
      environment,
      prereqStateCache
    );
    if (!removeRule) {
      newData.experiment.phases[phaseIndex].prerequisites = newPrerequisites;
      newExperiments.push(newData);
    }
  }
  return newExperiments;
};

const getInlinePrerequisitesReductionInfo = (
  prerequisites: FeaturePrerequisite[],
  featuresMap: Map<string, FeatureInterface>,
  environment: string,
  prereqStateCache: Record<string, Record<string, PrerequisiteStateResult>> = {}
): {
  removeRule: boolean;
  newPrerequisites: FeaturePrerequisite[];
} => {
  prereqStateCache[environment] = prereqStateCache[environment] || {};

  let removeRule = false;
  const newPrerequisites: FeaturePrerequisite[] = [];

  for (const pc of prerequisites) {
    const prereqFeature = featuresMap.get(pc.id);
    let state: PrerequisiteStateResult = {
      state: "deterministic",
      value: null,
    };
    if (prereqStateCache[environment][pc.id]) {
      state = prereqStateCache[environment][pc.id];
    } else {
      if (prereqFeature) {
        state = evaluatePrerequisiteState(
          prereqFeature,
          featuresMap,
          environment,
          undefined,
          true
        );
      }
      prereqStateCache[environment][pc.id] = state;
    }

    switch (state.state) {
      case "conditional":
        // keep the rule and prerequisite
        break;
      case "cyclic":
        // remove the rule
        removeRule = true;
        continue;
      case "deterministic": {
        const evaled = evalDeterministicPrereqValue(
          state.value ?? null,
          pc.condition
        );
        if (evaled === "fail") {
          // remove the rule
          removeRule = true;
        }
        continue;
      }
    }

    // only keep the prerequisite if switch logic hasn't prevented it
    newPrerequisites.push(pc);
  }

  return {
    removeRule,
    newPrerequisites,
  };
};
