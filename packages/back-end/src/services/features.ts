import { webcrypto as crypto } from "node:crypto";
import { createHash } from "crypto";
import { z } from "zod";
import uniqid from "uniqid";
import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
import {
  AutoExperiment,
  FeatureRule as FeatureDefinitionRule,
  GrowthBook,
} from "@growthbook/growthbook";
import {
  buildReverseDependencyIndex,
  evalDeterministicPrereqValue,
  evaluatePrerequisiteState,
  filterProjectsByEnvironmentWithNull,
  getDependentFeatures,
  getRulesForEnvironment,
  isDefined,
  MergeResultChanges,
  PrerequisiteStateResult,
  toApiNamespace,
  validateCondition,
  validateFeatureValue,
  getSavedGroupsValuesFromGroupMap,
  getSavedGroupsValuesFromInterfaces,
  NodeHandler,
  recursiveWalk,
  checkIfRevisionNeedsReview,
  ruleAppliesToEnv,
  namespacesToMap,
  stemRuleId,
  getConfigBackingKey,
  getConfigBackingPatch,
  stripConfigExtends,
} from "shared/util";
import {
  getConnectionSDKCapabilities,
  getPayloadAllowedKeys,
  replaceSavedGroups,
  SDKCapability,
  buildConstantValueMap,
  ConstantValueMap,
} from "shared/sdk-versioning";
import { ConstantInterface } from "shared/types/constant";
import { getLatestPhaseVariations } from "shared/experiments";
import cloneDeep from "lodash/cloneDeep";
import pickBy from "lodash/pickBy";
import {
  GroupMap,
  SavedGroupsValues,
  SavedGroupInterface,
} from "shared/types/saved-group";
import { clone } from "lodash";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { ArchetypeAttributeValues } from "shared/types/archetype";
import {
  AutoExperimentWithMetadata,
  ExperimentMetadata,
  FeatureDefinition,
} from "shared/types/sdk";
import { ProjectInterface } from "shared/types/project";
import {
  HoldoutInterface,
  ContextualBanditInterface,
  SdkConnectionCacheAuditContext,
  ApiEventUser,
  apiFeatureRevisionValidator,
  ApiFeatureWithRevisions,
  ApiFeatureEnvironment,
  ApiFeatureRule,
  ApiFeatureRuleV2,
  apiFeatureRevisionV2Validator,
  ApiFeatureWithRevisionsV2,
  ApiFeatureEnvironmentV2,
} from "shared/validators";
import {
  AttributeMap,
  ExperimentRefRule,
  ExperimentRule,
  FeatureDraftChanges,
  FeatureEnvironment,
  FeatureInterface,
  FeaturePrerequisite,
  FeatureRule,
  FeatureTestResult,
  ForceRule,
  RolloutRule,
} from "shared/types/feature";
import {
  Environment,
  OrganizationInterface,
  SDKAttribute,
  SDKAttributeSchema,
} from "shared/types/organization";
import { ExperimentInterface, ExperimentPhase } from "shared/types/experiment";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { SafeRolloutInterface } from "shared/types/safe-rollout";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { ApiReqContext } from "back-end/types/api";
import { assertRegisteredAttributes } from "back-end/src/services/attributes";
import { getResolvableValues } from "back-end/src/services/resolvableValues";
import {
  getAllFeatures,
  getAllFeaturesWithoutEditorFields,
} from "back-end/src/models/FeatureModel";
import {
  getAllPayloadExperiments,
  getAllURLRedirectExperiments,
  getAllVisualExperiments,
} from "back-end/src/models/ExperimentModel";
import {
  applyNamespaceToPayload,
  buildPayloadMetadata,
  getEnabledEnvironments,
  getFeatureDefinition,
  getHoldoutFeatureDefId,
  getParsedCondition,
} from "back-end/src/util/features";
import { getEnabledEnvironments as getEnabledHoldoutEnvironments } from "back-end/src/util/holdouts";
import { getApplicableEnvIds } from "back-end/src/util/flattenRules";
import { bucketRulesByEnv } from "back-end/src/util/toLegacy";
import { ReqContext } from "back-end/types/request";
import { BadRequestError, SoftWarningError } from "back-end/src/util/errors";
import { getSDKPayloadCacheLocation } from "back-end/src/models/SdkConnectionCacheModel";
import { logger } from "back-end/src/util/logger";
import { Counter, Histogram, metrics } from "back-end/src/util/metrics";
import { getEnvironments } from "back-end/src/util/organization.util";
import { promiseAllChunks } from "back-end/src/util/promise";
import { SDKPayloadKey } from "back-end/types/sdk-payload";
import {
  ApiFeatureEnvSettings,
  ApiFeatureEnvSettingsRules,
} from "back-end/src/api/features/postFeature";
import { triggerWebhookJobs } from "back-end/src/jobs/updateAllJobs";
import {
  createRevision,
  getRevision,
  normalizeRulesInputToV2,
} from "back-end/src/models/FeatureRevisionModel";
import { findSDKConnectionsByOrganization } from "back-end/src/models/SdkConnectionModel";
import { RampMonitoredRuleInfo } from "back-end/src/models/RampScheduleModel";
import {
  getContextForAgendaJobByOrgObject,
  getEnvironmentIdsFromOrg,
} from "./organizations";

export function generateFeaturesPayload({
  features,
  experimentMap,
  environment,
  groupMap,
  constants,
  constantMap: providedConstantMap,
  prereqStateCache = {},
  safeRolloutMap,
  holdoutsMap,
  includeProjectIdInMetadata,
  includeCustomFieldsInMetadata,
  allowedCustomFieldsInMetadata,
  includeTagsInMetadata,
  projectsMap,
  capabilities,
  savedGroupReferencesEnabled,
  organization,
  savedGroupsMap,
  includeRuleIds,
  includeExperimentNames,
  cbMap,
  includeDraftExperimentRefs,
  rampMonitoredRuleMap,
}: {
  features: FeatureInterface[];
  experimentMap: Map<string, ExperimentInterface>;
  environment: string;
  groupMap: GroupMap;
  constants?: ConstantInterface[];
  // Optional pre-built per-environment constant map (see SDKPayloadRawData).
  // When omitted, it's built here from `constants` + `environment`.
  constantMap?: ConstantValueMap | null;
  prereqStateCache?: Record<string, PrerequisiteStateResult>;
  safeRolloutMap: Map<string, SafeRolloutInterface>;
  holdoutsMap: Map<
    string,
    { holdout: HoldoutInterface; holdoutExperiment: ExperimentInterface }
  >;
  includeProjectIdInMetadata?: boolean;
  includeCustomFieldsInMetadata?: boolean;
  allowedCustomFieldsInMetadata?: string[];
  includeTagsInMetadata?: boolean;
  projectsMap?: Map<string, ProjectInterface>;
  capabilities?: SDKCapability[];
  savedGroupReferencesEnabled?: boolean;
  organization?: OrganizationInterface;
  savedGroupsMap?: Record<string, SavedGroupInterface>;
  includeRuleIds?: boolean;
  includeExperimentNames?: boolean;
  cbMap?: Map<string, ContextualBanditInterface>;
  includeDraftExperimentRefs?: boolean;
  rampMonitoredRuleMap?: Map<string, RampMonitoredRuleInfo>;
}): Record<string, FeatureDefinition> {
  const defs: Record<string, FeatureDefinition> = {};
  const newFeatures = reduceFeaturesWithPrerequisites(
    features,
    environment,
    prereqStateCache,
  );

  // Resolve `@const:` references at payload-build time (per environment). Use a
  // caller-provided map when present (the bulk refresh builds it once per env);
  // otherwise build it here. Skip entirely when the org has no constants — zero
  // overhead for the common case.
  const constantMap =
    providedConstantMap !== undefined
      ? providedConstantMap
      : constants?.length
        ? buildConstantValueMap(constants, environment)
        : null;

  newFeatures.forEach((feature) => {
    const reportedCycles = new Set<string>();
    const def = getFeatureDefinition({
      feature,
      environment,
      groupMap,
      experimentMap,
      safeRolloutMap,
      holdoutsMap,
      capabilities,
      savedGroupReferencesEnabled,
      organization,
      savedGroupsMap,
      includeRuleIds,
      includeExperimentNames,
      includeDraftExperimentRefs,
      rampMonitoredRuleMap,
      metadataOptions: {
        includeProjectIdInMetadata,
        includeCustomFieldsInMetadata,
        allowedCustomFieldsInMetadata,
        includeTagsInMetadata,
      },
      projectsMap,
      cbMap,
      constantMap: constantMap ?? undefined,
      onConstantCycle: (key) => {
        if (reportedCycles.has(key)) return;
        reportedCycles.add(key);
        logger.warn(
          {
            organization: organization?.id,
            feature: feature.id,
            environment,
            constant: key,
          },
          "Cyclic constant reference detected during SDK payload generation; left unresolved",
        );
      },
    });
    if (def) {
      defs[feature.id] = def;
    }
  });

  return defs;
}

function buildHoldoutsMapForProjects(
  holdoutsMap: Map<
    string,
    { holdout: HoldoutInterface; holdoutExperiment: ExperimentInterface }
  >,
  projects: string[],
): Map<
  string,
  { holdout: HoldoutInterface; holdoutExperiment: ExperimentInterface }
> {
  const result = new Map<
    string,
    { holdout: HoldoutInterface; holdoutExperiment: ExperimentInterface }
  >();
  holdoutsMap.forEach((value, id) => {
    const { holdout } = value;
    const allowed =
      projects.length === 0 ||
      holdout.projects.length === 0 ||
      holdout.projects.some((p) => projects.includes(p));
    if (allowed) result.set(id, value);
  });
  return result;
}

// Caller must pass holdouts map already filtered by project (e.g. buildHoldoutsMapForProjects).
export function generateHoldoutsPayload({
  holdoutsMap,
}: {
  holdoutsMap: Map<
    string,
    { holdout: HoldoutInterface; holdoutExperiment: ExperimentInterface }
  >;
}): Record<string, FeatureDefinition> {
  const holdoutDefs: Record<string, FeatureDefinition> = {};
  holdoutsMap.forEach((holdoutWithExperiment) => {
    const exp = holdoutWithExperiment.holdoutExperiment;
    const holdout = holdoutWithExperiment.holdout;
    if (!exp) return;

    const def: FeatureDefinition = {
      defaultValue: "genpop",
      rules: [
        {
          id: getHoldoutFeatureDefId(holdout.id),
          coverage: exp.phases[0].coverage,
          hashAttribute: exp.hashAttribute,
          seed: exp.phases[0].seed,
          hashVersion: 2,
          variations: ["holdoutcontrol", "holdouttreatment"],
          weights: [0.5, 0.5],
          key: exp.trackingKey,
          phase: `${exp.phases.length - 1}`,
          meta: [{ key: "0" }, { key: "1" }],
        },
      ],
    };
    holdoutDefs[getHoldoutFeatureDefId(holdout.id)] = def;
  });
  return holdoutDefs;
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
  includeProjectIdInMetadata,
  includeCustomFieldsInMetadata,
  allowedCustomFieldsInMetadata,
  includeTagsInMetadata,
  projectsMap,
  capabilities,
  savedGroupReferencesEnabled,
  organization,
  savedGroupsMap,
  includeExperimentNames,
}: {
  visualExperiments: VisualExperiment[];
  urlRedirectExperiments: URLRedirectExperiment[];
  groupMap: GroupMap;
  features: FeatureInterface[];
  environment: string;
  prereqStateCache?: Record<string, PrerequisiteStateResult>;
  includeProjectIdInMetadata?: boolean;
  includeCustomFieldsInMetadata?: boolean;
  allowedCustomFieldsInMetadata?: string[];
  includeTagsInMetadata?: boolean;
  projectsMap?: Map<string, ProjectInterface>;
  capabilities?: SDKCapability[];
  savedGroupReferencesEnabled?: boolean;
  organization?: OrganizationInterface;
  savedGroupsMap?: Record<string, SavedGroupInterface>;
  includeExperimentNames?: boolean;
}): AutoExperimentWithMetadata[] {
  const savedGroups = getSavedGroupsValuesFromGroupMap(groupMap);
  const isValidSDKExperiment = (
    e: AutoExperimentWithMetadata | null,
  ): e is AutoExperimentWithMetadata => !!e;

  const newVisualExperiments = reduceExperimentsWithPrerequisites(
    visualExperiments,
    features,
    environment,
    savedGroups,
    prereqStateCache,
  );

  const newURLRedirectExperiments = reduceExperimentsWithPrerequisites(
    urlRedirectExperiments,
    features,
    environment,
    savedGroups,
    prereqStateCache,
  );

  const sortedAutoExperiments = [
    ...newURLRedirectExperiments,
    ...newVisualExperiments,
  ];

  const sdkExperiments: Array<AutoExperimentWithMetadata | null> =
    sortedAutoExperiments.map((data) => {
      const { experiment: e } = data;
      if (e.status === "stopped" && e.excludeFromPayload) return null;

      const phase: ExperimentPhase | null = e.phases?.slice(-1)?.[0] ?? null;

      const variations = getLatestPhaseVariations(e);

      const hasForcedVariation =
        e.status === "stopped" && e.releasedVariationId;

      const forcedVariation = hasForcedVariation
        ? variations.find((v) => v.id === e.releasedVariationId)
        : null;

      const condition = getParsedCondition(
        groupMap,
        phase?.condition,
        phase?.savedGroups,
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
        .filter(isDefined);

      if (!phase) return null;

      if (capabilities !== undefined) {
        if (!capabilities.includes("redirects") && data.type === "redirect")
          return null;
        if (!capabilities.includes("prerequisites") && prerequisites.length > 0)
          return null;
      }

      const implementationId =
        data.type === "redirect"
          ? data.urlRedirect.id
          : data.visualChangeset.id;

      const exp: AutoExperimentWithMetadata = {
        key: e.trackingKey,
        changeId: sha256(
          `${e.trackingKey}_${data.type}_${implementationId}`,
          "",
        ),
        status: e.status,
        variations: variations.map((v) => {
          if (data.type === "redirect") {
            const match = data.urlRedirect.destinationURLs.find(
              (d) => d.variation === v.id,
            );
            return {
              urlRedirect: match?.url || "",
            };
          }

          const match = data.visualChangeset.visualChanges.find(
            (vc) => vc.variation === v.id,
          );
          return {
            css: match?.css || "",
            js: match?.js || "",
            domMutations: match?.domMutations || [],
          };
        }) as AutoExperiment["variations"],
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
        meta: variations.map((v) =>
          includeExperimentNames === true
            ? { key: v.key, name: v.name }
            : { key: v.key },
        ),
        seed: phase.seed,
        ...(includeExperimentNames === true ? { name: e.name } : {}),
        phase: `${e.phases.length - 1}`,
        force: forcedVariation
          ? variations.indexOf(forcedVariation)
          : undefined,
        condition,
        coverage: phase.coverage,
      };

      // Handle namespace
      if (phase?.namespace?.enabled && phase.namespace.name) {
        applyNamespaceToPayload(
          exp,
          phase.namespace,
          namespacesToMap(organization?.settings?.namespaces),
        );
      }

      if (prerequisites.length) {
        exp.parentConditions = prerequisites;
      }

      if (data.type === "redirect" && data.urlRedirect.persistQueryString) {
        exp.persistQueryString = true;
      }

      const metadata = buildPayloadMetadata<ExperimentMetadata>(
        { project: e.project, customFields: e.customFields, tags: e.tags },
        {
          includeProjectIdInMetadata,
          includeCustomFieldsInMetadata,
          allowedCustomFieldsInMetadata,
          includeTagsInMetadata,
        },
        projectsMap,
      );
      if (metadata) exp.metadata = metadata;

      if (capabilities !== undefined && savedGroupsMap && organization) {
        if (
          !capabilities.includes("savedGroupReferences") ||
          savedGroupReferencesEnabled === false
        ) {
          recursiveWalk(
            exp.condition,
            replaceSavedGroups(savedGroupsMap, organization),
          );
          recursiveWalk(
            exp.parentConditions,
            replaceSavedGroups(savedGroupsMap, organization),
          );
        }
        const { removedExperimentKeys } = getPayloadAllowedKeys(capabilities);
        if (removedExperimentKeys.length) {
          return omit(exp, removedExperimentKeys) as AutoExperimentWithMetadata;
        }
      }

      return exp;
    });
  return sdkExperiments.filter(isValidSDKExperiment);
}

export async function getSavedGroupMap(
  context: ReqContext | ApiReqContext,
  savedGroups?: SavedGroupInterface[],
): Promise<GroupMap> {
  const organization = context.org;
  const attributes = organization.settings?.attributeSchema;

  const attributeMap: AttributeMap = new Map();
  attributes?.forEach((attribute) => {
    attributeMap.set(attribute.property, attribute.datatype);
  });

  // Get "SavedGroups" for an organization and build a map of the SavedGroup's Id to the actual array of IDs, respecting the type.
  const allGroups =
    typeof savedGroups === "undefined"
      ? await context.models.savedGroups.getAll()
      : savedGroups;

  function getGroupValues(
    values: string[],
    type?: string,
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
    }),
  );

  return groupMap;
}

// Only produce the id lists which are used by at least one feature or experiment
export function filterUsedSavedGroups(
  savedGroups: SavedGroupsValues,
  features: Record<string, FeatureDefinition>,
  experimentsDefinitions: AutoExperiment[],
) {
  const usedGroupIds = new Set();
  const addToUsedGroupIds: NodeHandler = (node) => {
    if (node[0] === "$inGroup" || node[0] === "$notInGroup") {
      usedGroupIds.add(node[1]);
    }
  };
  Object.values(features).forEach((feature) => {
    if (!feature.rules) {
      return;
    }
    feature.rules.forEach((rule) => {
      recursiveWalk(rule.condition, addToUsedGroupIds);
      recursiveWalk(rule.parentConditions, addToUsedGroupIds);
    });
  });
  experimentsDefinitions.forEach((experimentDefinition) => {
    recursiveWalk(experimentDefinition.condition, addToUsedGroupIds);
    recursiveWalk(experimentDefinition.parentConditions, addToUsedGroupIds);
  });

  return pickBy(savedGroups, (_values, savedGroupId) =>
    usedGroupIds.has(savedGroupId),
  );
}

export function isSDKConnectionAffectedByPayloadKey(
  connection: SDKConnectionInterface,
  payloadKey: SDKPayloadKey,
  treatEmptyProjectAsGlobal = false,
): boolean {
  // Environment must match
  if (connection.environment !== payloadKey.environment) {
    return false;
  }

  // Global payload keys affect all projects
  if (treatEmptyProjectAsGlobal && !payloadKey.project) {
    return true;
  }

  // If connection is global (not project scoped), it matches
  if (!connection.projects?.length) {
    return true;
  }

  // Otherwise, the connection must include the project explicitly
  return connection.projects.includes(payloadKey.project);
}

let sdkPayloadRefreshesCounter: Counter | null = null;
let sdkPayloadRefreshDurationHistogram: Histogram | null = null;

function getSdkPayloadRefreshesCounter() {
  if (!sdkPayloadRefreshesCounter) {
    sdkPayloadRefreshesCounter = metrics.getCounter("sdk_payload.refreshes");
  }
  return sdkPayloadRefreshesCounter;
}

function getSdkPayloadRefreshDurationHistogram() {
  if (!sdkPayloadRefreshDurationHistogram) {
    sdkPayloadRefreshDurationHistogram = metrics.getHistogram(
      "sdk_payload.refresh_duration_ms",
    );
  }
  return sdkPayloadRefreshDurationHistogram;
}

function recordSdkPayloadRefreshMetrics(durationMs: number) {
  try {
    getSdkPayloadRefreshesCounter().increment();
    getSdkPayloadRefreshDurationHistogram().record(durationMs);
  } catch (e) {
    logger.error({ err: e }, "Error recording sdk_payload refresh metrics");
  }
}

// This is a synchronous wrapper around refreshSDKPayloadCache
// We shouldn't need to await the refresh in most cases
export function queueSDKPayloadRefresh(data: {
  context: ReqContext | ApiReqContext;
  payloadKeys: SDKPayloadKey[];
  sdkConnections?: SDKConnectionInterface[];
  skipRefreshForProject?: string;
  treatEmptyProjectAsGlobal?: boolean;
  auditContext?: { event: string; model: string; id?: string };
}) {
  // Capture stack trace at the entry point to include the original caller
  const rawStack = new Error().stack || "";
  const stackTrace = rawStack.replace(/^Error.*?\n/, "");
  refreshSDKPayloadCache({ ...data, stackTrace }).catch((e) => {
    logger.error(e, "Error refreshing SDK Payload Cache");
  });
}

// Live features that list `featureId` as a prerequisite — top-level or on an
// enabled rule (`getDependentFeatures` covers both). Deleting a feature that
// something still gates on dangles the reference: a top-level prerequisite is
// emitted as a `gate: true` parentCondition (see getFeatureDefinition in
// util/features.ts), and a gate whose parent feature is absent from the payload
// can never pass, so the dependent is silently dropped from every SDK payload
// (fail-closed). We scan org-wide (a dependent in an unreadable project still
// breaks) and skip archived features, which aren't served anyway. Deletes are
// infrequent, so a single lightweight whole-collection scan is acceptable.
export async function getFeaturesDependingOnAsPrerequisite(
  context: ReqContext | ApiReqContext,
  featureId: string,
): Promise<string[]> {
  const scanContext = getContextForAgendaJobByOrgObject(context.org);
  // Candidates are live features only — an archived dependent isn't served, so
  // it can't be outaged. The target being deleted is usually archived (delete
  // requires it), so it needn't be in this list: getDependentFeatures matches
  // on `feature.id` alone, so a stub target suffices.
  const features = await getAllFeaturesWithoutEditorFields(scanContext, {});
  const envIds = getEnvironments(scanContext.org).map((e) => e.id);
  const reverseDependencyIndex = buildReverseDependencyIndex(features);
  const featuresMap = new Map(features.map((f) => [f.id, f]));
  const dependents = getDependentFeatures(
    { id: featureId } as FeatureInterface,
    features,
    envIds,
    reverseDependencyIndex,
    featuresMap,
  );
  return dependents.filter((id) => id !== featureId);
}

// Block deleting a feature that live features still list as a prerequisite —
// deletion would dangle their gate and drop them from the SDK payload. Matches
// the copy style of assertConstantArchivable / assertSavedGroupDeletable.
export async function assertFeatureDeletable(
  context: ReqContext | ApiReqContext,
  featureId: string,
): Promise<void> {
  const dependents = await getFeaturesDependingOnAsPrerequisite(
    context,
    featureId,
  );
  if (!dependents.length) return;
  // Count only — the dependent scan is org-wide (so a dependent in a project
  // the caller can't read still blocks), so naming ids would disclose
  // cross-project features. Mirrors assertSavedGroupDeletable / assertConstantArchivable.
  throw new BadRequestError(
    `Cannot delete Feature Flag: it is still used as a prerequisite by ${dependents.length} live Feature Flag(s). Remove these references first.`,
  );
}

export async function refreshSDKPayloadCache({
  context: baseContext,
  payloadKeys,
  skipRefreshForProject,
  sdkConnections: sdkConnectionsToUpdate = [],
  treatEmptyProjectAsGlobal = false,
  auditContext: initialAuditContext,
  stackTrace,
}: {
  context: ReqContext | ApiReqContext;
  payloadKeys: SDKPayloadKey[];
  sdkConnections?: SDKConnectionInterface[];
  skipRefreshForProject?: string;
  treatEmptyProjectAsGlobal?: boolean;
  auditContext?: { event: string; model: string; id?: string };
  stackTrace?: string;
}) {
  // This is a background job, so switch to using a background context
  // This is required so that we have full read access to the entire org's data
  const context = getContextForAgendaJobByOrgObject(baseContext.org);

  logger.debug(
    `Refreshing SDK Payloads for ${context.org.id}: ${JSON.stringify(
      payloadKeys,
    )}`,
  );

  // Ignore any old environments which don't exist anymore
  const allowedEnvs = new Set(getEnvironmentIdsFromOrg(context.org));
  payloadKeys = payloadKeys.filter((k) => allowedEnvs.has(k.environment));

  // Remove any projects to skip
  if (skipRefreshForProject) {
    payloadKeys = payloadKeys.filter(
      (k) => k.project !== skipRefreshForProject,
    );
  }

  // If no environments are affected, we don't need to update anything
  if (!payloadKeys.length && !sdkConnectionsToUpdate.length) {
    logger.debug(
      { orgId: context.org.id, auditContext: initialAuditContext },
      "[sdk-payload] refresh skipped — no environments affected",
    );
    return;
  }

  const storageLocation = getSDKPayloadCacheLocation();
  const refreshStartedAt = performance.now();

  // Clear any cache entries for legacy API keys since they can't be tracked individually
  try {
    await context.models.sdkConnectionCache.deleteAllLegacyCacheEntries();
  } catch (e) {
    logger.warn(e, "Failed to delete legacy cache entries");
  }

  const experimentMap = await getAllPayloadExperiments(context);
  const safeRolloutMap =
    await context.models.safeRollout.getAllPayloadSafeRollouts();
  const savedGroups = await context.models.savedGroups.getAll();
  const groupMap = await getSavedGroupMap(context, savedGroups);
  const allFeatures = await getAllFeatures(context);
  const constants = await getResolvableValues(context);
  const rampMonitoredRuleMap =
    await context.models.rampSchedules.getPayloadRampMonitoredRuleMap();

  const [allVisualExperiments, allURLRedirectExperiments] = await Promise.all([
    getAllVisualExperiments(context, experimentMap),
    getAllURLRedirectExperiments(context, experimentMap),
  ]);

  const rawData: Omit<SDKPayloadRawData, "holdoutsMap"> = {
    features: allFeatures,
    experimentMap,
    groupMap,
    safeRolloutMap,
    savedGroups,
    visualExperiments: allVisualExperiments,
    urlRedirectExperiments: allURLRedirectExperiments,
    rampMonitoredRuleMap,
    constants,
  };

  const payloadKeyEnvironments = new Set(payloadKeys.map((k) => k.environment));
  const allEnvironmentsToUpdate = Array.from(
    new Set([
      ...payloadKeyEnvironments,
      ...sdkConnectionsToUpdate.map((c) => c.environment),
    ]),
  );

  const holdoutsMapByEnv: Record<
    string,
    Map<
      string,
      { holdout: HoldoutInterface; holdoutExperiment: ExperimentInterface }
    >
  > = {};
  // Build the constant value map once per environment (parsing each JSON
  // constant once), shared across every connection in that env — rather than
  // rebuilding it inside generateFeaturesPayload per connection.
  const constantMapByEnv: Record<string, ConstantValueMap | null> = {};
  for (const environment of allEnvironmentsToUpdate) {
    holdoutsMapByEnv[environment] =
      await context.models.holdout.getAllPayloadHoldouts(environment);
    constantMapByEnv[environment] = constants.length
      ? buildConstantValueMap(constants, environment)
      : null;
  }

  const sdkConnections = payloadKeys.length
    ? await findSDKConnectionsByOrganization(context)
    : sdkConnectionsToUpdate;

  if (sdkConnections.some((c) => c.includeProjectIdInMetadata)) {
    const allProjects = await context.models.projects.getAll();
    rawData.projectsMap = new Map(allProjects.map((p) => [p.id, p]));
  }

  const connectionsUpdated: SDKConnectionInterface[] = [];
  const promises: (() => Promise<void>)[] = [];

  sdkConnections.forEach((connection) => {
    if (
      !sdkConnectionsToUpdate.some((c) => c.key === connection.key) &&
      !payloadKeys.some((k) =>
        isSDKConnectionAffectedByPayloadKey(
          connection,
          k,
          treatEmptyProjectAsGlobal,
        ),
      )
    ) {
      return;
    }

    const env = connection.environment;
    const holdoutsMap = holdoutsMapByEnv[env];
    if (!holdoutsMap) {
      return;
    }
    connectionsUpdated.push(connection);

    promises.push(async () => {
      try {
        const capabilities = getConnectionSDKCapabilities(connection);
        const environmentDoc = context.org?.settings?.environments?.find(
          (e) => e.id === env,
        );
        const filteredProjects = filterProjectsByEnvironmentWithNull(
          connection.projects || [],
          environmentDoc,
          true,
        );

        const contents = await buildSDKPayloadForConnection({
          context,
          connection: {
            id: connection.id,
            capabilities,
            environment: env,
            projects: filteredProjects,
            encryptPayload: connection.encryptPayload,
            encryptionKey: connection.encryptionKey,
            includeVisualExperiments: connection.includeVisualExperiments,
            includeDraftExperiments: connection.includeDraftExperiments,
            includeDraftExperimentRefs: connection.includeDraftExperimentRefs,
            includeExperimentNames: connection.includeExperimentNames,
            includeRedirectExperiments: connection.includeRedirectExperiments,
            includeRuleIds: connection.includeRuleIds,
            hashSecureAttributes: connection.hashSecureAttributes,
            savedGroupReferencesEnabled:
              connection.savedGroupReferencesEnabled &&
              capabilities.includes("savedGroupReferences"),
            includeProjectIdInMetadata: connection.includeProjectIdInMetadata,
            includeCustomFieldsInMetadata:
              connection.includeCustomFieldsInMetadata,
            allowedCustomFieldsInMetadata:
              connection.allowedCustomFieldsInMetadata,
            includeTagsInMetadata: connection.includeTagsInMetadata,
            sessionReplayEnabled: connection.sessionReplayEnabled,
          },
          data: { ...rawData, holdoutsMap, constantMap: constantMapByEnv[env] },
        });

        const auditContext: SdkConnectionCacheAuditContext | undefined =
          initialAuditContext
            ? {
                dateUpdated: new Date(),
                event: initialAuditContext.event,
                model: initialAuditContext.model,
                id: initialAuditContext.id,
                stack: stackTrace || "",
                connection: connection as unknown as Record<string, unknown>,
              }
            : undefined;

        if (storageLocation !== "none") {
          await context.models.sdkConnectionCache.upsert(
            connection.key,
            JSON.stringify(contents),
            auditContext,
          );
        }
      } catch (e) {
        logger.error(e, "Error updating SDK connection cache");
      }
    });
  });

  // If there are no changes, we don't need to do anything
  if (!promises.length) {
    const durationMs = Math.round(performance.now() - refreshStartedAt);
    recordSdkPayloadRefreshMetrics(durationMs);
    logger.info(
      {
        orgId: context.org.id,
        payloadKeys,
        auditContext: initialAuditContext,
        durationMs,
      },
      "[sdk-payload] refresh skipped — no matching SDK connections",
    );
    return;
  }

  // There may be many SDK connection caches to update
  // Batch the promises in chunks of 4 at a time to avoid overloading Mongo
  await promiseAllChunks(promises, 4);

  const durationMs = Math.round(performance.now() - refreshStartedAt);
  recordSdkPayloadRefreshMetrics(durationMs);
  logger.info(
    {
      orgId: context.org.id,
      connectionKeys: connectionsUpdated.map((c) => c.key),
      connectionCount: connectionsUpdated.length,
      payloadKeys,
      cacheLocation: storageLocation,
      auditContext: initialAuditContext,
      durationMs,
    },
    "[sdk-payload] refresh completed",
  );

  triggerWebhookJobs(context, payloadKeys, connectionsUpdated, true).catch(
    (e) => {
      logger.error(e, "Error triggering webhook jobs");
    },
  );
}

// Session-replay capture config delivered in the SDK payload. Shaped as a
// `rules` array (Stage 1 emits a single global-rate rule) so future conditional
// sampling (§14) can add per-rule conditions without a breaking change.
// Only the enable/disable flag rides the payload (kept minimal for size).
// Sampling controls (rate, min-duration) are configured in the SDK init code
// for now — revisit moving them here in fast-follow plan §12.3 Phase 2.
export type SessionReplaySDKPayload = {
  enabled: boolean;
};

export type FeatureDefinitionsResponseArgs = {
  features: Record<string, FeatureDefinition>;
  experiments?: AutoExperiment[];
  dateUpdated: Date | null;
  encryptPayload?: boolean;
  encryptionKey?: string;
  includeDraftExperiments?: boolean;
  attributes?: SDKAttributeSchema;
  secureAttributeSalt?: string;
  projects?: string[];
  capabilities: SDKCapability[];
  usedSavedGroups: SavedGroupInterface[];
  savedGroupReferencesEnabled?: boolean;
  organization: OrganizationInterface;
  sessionReplay?: SessionReplaySDKPayload;
};
export async function getFeatureDefinitionsResponse({
  features,
  experiments,
  dateUpdated,
  encryptPayload,
  encryptionKey,
  includeDraftExperiments,
  attributes,
  secureAttributeSalt,
  capabilities,
  usedSavedGroups,
  savedGroupReferencesEnabled,
  organization,
  sessionReplay,
}: FeatureDefinitionsResponseArgs): Promise<{
  features: Record<string, FeatureDefinition>;
  experiments?: AutoExperiment[];
  dateUpdated: Date | null;
  encryptedFeatures?: string;
  encryptedExperiments?: string;
  savedGroups?: SavedGroupsValues;
  encryptedSavedGroups?: string;
  sessionReplay?: SessionReplaySDKPayload;
}> {
  features = cloneDeep(features);
  let processedExperiments: AutoExperiment[] =
    experiments !== undefined ? cloneDeep(experiments) : [];
  usedSavedGroups = cloneDeep(usedSavedGroups);

  if (experiments !== undefined && !includeDraftExperiments) {
    processedExperiments = processedExperiments.filter(
      (e) => e.status !== "draft",
    );
  }

  // Inline saved groups: expand $inGroup to $in when not using savedGroupReferences.
  // When called from buildSDKPayloadForConnection, getFeatureDefinition already expanded; this pass is a no-op.
  if (
    (!capabilities.includes("savedGroupReferences") ||
      !savedGroupReferencesEnabled) &&
    usedSavedGroups?.length > 0 &&
    organization
  ) {
    const savedGroupsMap = Object.fromEntries(
      usedSavedGroups.map((sg) => [sg.id, sg]),
    );
    for (const k in features) {
      if (features[k]?.rules) {
        for (const rule of features[k].rules ?? []) {
          if (rule.condition) {
            recursiveWalk(
              rule.condition,
              replaceSavedGroups(savedGroupsMap, organization),
            );
          }
          if (rule.parentConditions) {
            recursiveWalk(
              rule.parentConditions,
              replaceSavedGroups(savedGroupsMap, organization),
            );
          }
        }
      }
    }
  }

  const hasSecureAttributes = attributes?.some((a) =>
    ["secureString", "secureString[]"].includes(a.datatype),
  );
  if (attributes && hasSecureAttributes && secureAttributeSalt !== undefined) {
    features = applyFeatureHashing(features, attributes, secureAttributeSalt);

    if (experiments !== undefined) {
      processedExperiments = applyExperimentHashing(
        processedExperiments,
        attributes,
        secureAttributeSalt,
      );
    }

    usedSavedGroups = applySavedGroupHashing(
      usedSavedGroups,
      attributes,
      secureAttributeSalt,
    );
  }

  const savedGroupsValues = getSavedGroupsValuesFromInterfaces(
    usedSavedGroups,
    organization,
  );

  const savedGroupsForPayload =
    capabilities.includes("savedGroupReferences") && savedGroupReferencesEnabled
      ? savedGroupsValues
      : undefined;

  if (!encryptPayload || !encryptionKey) {
    return {
      features,
      ...(experiments !== undefined && { experiments: processedExperiments }),
      dateUpdated,
      savedGroups: savedGroupsForPayload,
      // Session replay config is not feature data — always plaintext.
      ...(sessionReplay && { sessionReplay }),
    };
  }

  const encryptedFeatures = await encrypt(
    JSON.stringify(features),
    encryptionKey,
  );
  const encryptedExperiments =
    experiments !== undefined
      ? await encrypt(JSON.stringify(processedExperiments), encryptionKey)
      : undefined;

  const encryptedSavedGroups = savedGroupsForPayload
    ? await encrypt(JSON.stringify(savedGroupsForPayload), encryptionKey)
    : undefined;

  return {
    features: {},
    ...(experiments !== undefined && { experiments: [] }),
    dateUpdated,
    encryptedFeatures,
    ...(encryptedExperiments !== undefined && { encryptedExperiments }),
    encryptedSavedGroups: encryptedSavedGroups,
    // Session replay config is not feature data — always plaintext.
    ...(sessionReplay && { sessionReplay }),
  };
}

export type FeatureDefinitionArgs = {
  context: ReqContext | ApiReqContext;
  capabilities: SDKCapability[];
  environment?: string;
  projects?: string[] | null;
  encryptPayload?: boolean;
  encryptionKey?: string;
  includeVisualExperiments?: boolean;
  includeDraftExperiments?: boolean;
  includeDraftExperimentRefs?: boolean;
  includeExperimentNames?: boolean;
  includeRedirectExperiments?: boolean;
  includeRuleIds?: boolean;
  includeProjectIdInMetadata?: boolean;
  includeCustomFieldsInMetadata?: boolean;
  allowedCustomFieldsInMetadata?: string[];
  includeTagsInMetadata?: boolean;
  hashSecureAttributes?: boolean;
  savedGroupReferencesEnabled?: boolean;
  sessionReplayEnabled?: boolean;
};

// Pre-fetched data to build one connection's payload. Bulk refresh shares this and adds holdoutsMap per env; may include visualExperiments/urlRedirectExperiments to avoid repeated DB queries.
export type SDKPayloadRawData = {
  features: FeatureInterface[];
  experimentMap: Map<string, ExperimentInterface>;
  groupMap: GroupMap;
  safeRolloutMap: Map<string, SafeRolloutInterface>;
  savedGroups: SavedGroupInterface[];
  holdoutsMap: Map<
    string,
    { holdout: HoldoutInterface; holdoutExperiment: ExperimentInterface }
  >;
  visualExperiments?: VisualExperiment[];
  urlRedirectExperiments?: URLRedirectExperiment[];
  projectsMap?: Map<string, ProjectInterface>;
  rampMonitoredRuleMap?: Map<string, RampMonitoredRuleInfo>;
  constants?: ConstantInterface[];
  // Pre-built per-environment constant value map. Hoisted out of
  // generateFeaturesPayload so the bulk refresh builds it once per env (next to
  // holdoutsMapByEnv) instead of re-parsing every JSON constant for every
  // connection. When omitted, generateFeaturesPayload builds it from `constants`.
  constantMap?: ConstantValueMap | null;
};

// Payload-relevant subset of SDK connection (plus derived capabilities). Pass through encryptPayload + encryptionKey; effective key is derived inside buildSDKPayloadForConnection.
export type ConnectionPayloadOptions = {
  // SDK connection id — used to check per-connection operator kill membership.
  id?: string;
  capabilities: SDKCapability[];
  environment: string;
  projects: string[] | null;
  encryptPayload?: boolean;
  encryptionKey?: string;
  includeVisualExperiments?: boolean;
  includeDraftExperiments?: boolean;
  includeDraftExperimentRefs?: boolean;
  includeExperimentNames?: boolean;
  includeRedirectExperiments?: boolean;
  includeRuleIds?: boolean;
  hashSecureAttributes?: boolean;
  savedGroupReferencesEnabled?: boolean;
  includeProjectIdInMetadata?: boolean;
  includeCustomFieldsInMetadata?: boolean;
  allowedCustomFieldsInMetadata?: string[];
  includeTagsInMetadata?: boolean;
  sessionReplayEnabled?: boolean;
};

// Full input for building one connection's SDK payload
export type SDKPayloadBuildInput = {
  context: ReqContext | ApiReqContext;
  connection: ConnectionPayloadOptions;
  data: SDKPayloadRawData;
};

// Keep only holdout defs that are referenced by at least one feature rule.
function pruneUnreferencedHoldouts(
  holdouts: Record<string, FeatureDefinition>,
  features: Record<string, FeatureDefinition>,
): Record<string, FeatureDefinition> {
  const referenced = new Set<string>();
  for (const k in features) {
    for (const rule of features[k]?.rules ?? []) {
      const pcId = rule.parentConditions?.[0]?.id;
      if (pcId?.startsWith("$holdout:")) referenced.add(pcId);
    }
  }
  return Object.fromEntries(
    Object.entries(holdouts).filter(([key]) => referenced.has(key)),
  );
}

export async function buildSDKPayloadForConnection(
  input: SDKPayloadBuildInput,
): Promise<FeatureDefinitionSDKPayload> {
  const { context, connection, data } = input;
  const {
    id: connectionId,
    capabilities,
    environment = "production",
    projects,
    encryptPayload,
    encryptionKey,
    includeVisualExperiments,
    includeDraftExperiments,
    includeExperimentNames,
    includeRedirectExperiments,
    includeRuleIds,
    hashSecureAttributes,
    savedGroupReferencesEnabled,
    includeProjectIdInMetadata,
    includeCustomFieldsInMetadata,
    allowedCustomFieldsInMetadata,
    includeTagsInMetadata,
    sessionReplayEnabled,
  } = connection;

  // Operator break-glass: when a super-admin has force-disabled session replay
  // for the org (blanket) or this specific connection, always emit the block
  // with enabled:false so the SDK is forced off regardless of the connection's
  // own toggle (Phase 2 §12.1b/§12.1c). Otherwise only emit when the connection
  // has configured the toggle; when unset, omit so the SDK uses its init config.
  // NB: only `enabled` rides the payload — sampling stays in the SDK init config
  // for now (fast-follow plan §12.3 Phase 2).
  const orgSessionReplayKilled =
    context.org.sessionReplayDisabled === true ||
    (!!connectionId &&
      (context.org.sessionReplayDisabledConnectionIds ?? []).includes(
        connectionId,
      ));
  const sessionReplay: SessionReplaySDKPayload | undefined =
    !orgSessionReplayKilled && sessionReplayEnabled === undefined
      ? undefined
      : {
          enabled: orgSessionReplayKilled
            ? false
            : (sessionReplayEnabled ?? false),
        };

  if (projects === null) {
    return {
      features: {},
      experiments: [],
      dateUpdated: new Date(),
      savedGroups: {},
      ...(sessionReplay && { sessionReplay }),
    };
  }

  const projectList = projects && projects.length > 0 ? projects : [];
  const filteredFeatures =
    projectList.length > 0
      ? data.features.filter((f) => projectList.includes(f.project || ""))
      : data.features;
  const filteredExperimentMap =
    projectList.length > 0
      ? new Map(
          [...data.experimentMap.entries()].filter(([, exp]) =>
            projectList.includes(exp.project || ""),
          ),
        )
      : data.experimentMap;

  // Fresh cache per connection (one env per connection); keyed by prereq id only
  const prereqStateCache: Record<string, PrerequisiteStateResult> = {};

  const allVisualExperiments =
    data.visualExperiments != null
      ? data.visualExperiments.filter((e) =>
          filteredExperimentMap.has(e.experiment.id),
        )
      : await getAllVisualExperiments(context, filteredExperimentMap);
  const allURLRedirectExperiments =
    data.urlRedirectExperiments != null
      ? data.urlRedirectExperiments.filter((e) =>
          filteredExperimentMap.has(e.experiment.id),
        )
      : await getAllURLRedirectExperiments(context, filteredExperimentMap);

  const savedGroupsMap = Object.fromEntries(
    data.savedGroups.map((sg) => [sg.id, sg]),
  );

  const holdoutsMapForConnection = buildHoldoutsMapForProjects(
    data.holdoutsMap,
    projectList,
  );

  // Load projects map if metadata is requested and not already provided in bulk data
  let projectsMap: Map<string, ProjectInterface> | undefined = data.projectsMap;
  if (includeProjectIdInMetadata && !projectsMap) {
    const allProjects = await context.models.projects.getAll();
    projectsMap = new Map(allProjects.map((p) => [p.id, p]));
  }

  let cbMap: Map<string, ContextualBanditInterface> | undefined;
  const cbIdsFromRules: string[] = [];
  for (const feature of filteredFeatures) {
    const rules = feature.rules ?? [];
    for (const rule of rules) {
      if (rule.type === "contextual-bandit-ref" && rule.contextualBanditId) {
        cbIdsFromRules.push(rule.contextualBanditId);
      }
    }
  }
  const cbIds = Array.from(new Set(cbIdsFromRules));
  if (cbIds.length > 0) {
    const cbDocs = await Promise.all(
      cbIds.map((id) => context.models.contextualBandits.getById(id)),
    );
    cbMap = new Map(
      cbDocs
        .filter((cb): cb is ContextualBanditInterface => cb !== null)
        .map((cb) => [cb.id, cb]),
    );
  }

  const featureDefinitions = generateFeaturesPayload({
    features: filteredFeatures,
    environment,
    groupMap: data.groupMap,
    constants: data.constants,
    constantMap: data.constantMap,
    experimentMap: filteredExperimentMap,
    prereqStateCache,
    safeRolloutMap: data.safeRolloutMap,
    holdoutsMap: holdoutsMapForConnection,
    capabilities,
    savedGroupReferencesEnabled:
      !!savedGroupReferencesEnabled &&
      capabilities.includes("savedGroupReferences"),
    organization: context.org,
    savedGroupsMap,
    includeRuleIds,
    includeExperimentNames: connection.includeExperimentNames,
    includeDraftExperimentRefs: connection.includeDraftExperimentRefs,
    includeProjectIdInMetadata,
    includeCustomFieldsInMetadata,
    allowedCustomFieldsInMetadata,
    includeTagsInMetadata,
    projectsMap,
    cbMap,
    rampMonitoredRuleMap: data.rampMonitoredRuleMap,
  });

  const holdoutFeatureDefinitions = generateHoldoutsPayload({
    holdoutsMap: holdoutsMapForConnection,
  });

  const experimentsDefinitions = generateAutoExperimentsPayload({
    visualExperiments: includeVisualExperiments ? allVisualExperiments : [],
    urlRedirectExperiments: includeRedirectExperiments
      ? allURLRedirectExperiments
      : [],
    groupMap: data.groupMap,
    features: filteredFeatures,
    environment,
    prereqStateCache,
    capabilities,
    savedGroupReferencesEnabled:
      !!savedGroupReferencesEnabled &&
      capabilities.includes("savedGroupReferences"),
    organization: context.org,
    savedGroupsMap,
    includeExperimentNames,
    includeProjectIdInMetadata,
    includeCustomFieldsInMetadata,
    allowedCustomFieldsInMetadata,
    includeTagsInMetadata,
    projectsMap,
  });

  const savedGroupsInUse = filterUsedSavedGroups(
    getSavedGroupsValuesFromGroupMap(data.groupMap),
    featureDefinitions,
    experimentsDefinitions,
  );
  const usedSavedGroups = data.savedGroups.filter(
    (sg) => sg.id in savedGroupsInUse,
  );

  const holdoutsInUse = pruneUnreferencedHoldouts(
    holdoutFeatureDefinitions,
    featureDefinitions,
  );

  const featuresWithHoldouts = {
    ...featureDefinitions,
    ...holdoutsInUse,
  };

  let attributes: SDKAttributeSchema | undefined = undefined;
  let secureAttributeSalt: string | undefined = undefined;
  if (hashSecureAttributes) {
    secureAttributeSalt = context.org.settings?.secureAttributeSalt;
    attributes = context.org.settings?.attributeSchema;
  }

  return getFeatureDefinitionsResponse({
    features: featuresWithHoldouts,
    experiments:
      includeVisualExperiments || includeRedirectExperiments
        ? experimentsDefinitions
        : undefined,
    dateUpdated: new Date(),
    encryptPayload,
    encryptionKey,
    includeDraftExperiments,
    attributes,
    secureAttributeSalt,
    capabilities,
    usedSavedGroups,
    savedGroupReferencesEnabled:
      !!savedGroupReferencesEnabled &&
      capabilities.includes("savedGroupReferences"),
    organization: context.org,
    sessionReplay,
  });
}

export type FeatureDefinitionSDKPayload = {
  features: Record<string, FeatureDefinition>;
  experiments?: AutoExperiment[];
  dateUpdated: Date | null;
  encryptedFeatures?: string;
  encryptedExperiments?: string;
  savedGroups?: SavedGroupsValues;
  encryptedSavedGroups?: string;
  sessionReplay?: SessionReplaySDKPayload;
};

export async function getFeatureDefinitions(
  args: FeatureDefinitionArgs,
): Promise<FeatureDefinitionSDKPayload> {
  const { context, environment = "production", projects } = args;
  const projectFilter = projects && projects.length > 0 ? projects : undefined;
  const allSavedGroups = await context.models.savedGroups.getAll();
  const allFeatures = await getAllFeatures(context, {
    projects: projectFilter,
  });
  const groupMap = await getSavedGroupMap(context, allSavedGroups);
  const experimentMap = await getAllPayloadExperiments(context, projectFilter);
  const safeRolloutMap =
    await context.models.safeRollout.getAllPayloadSafeRollouts();
  const holdoutsMap =
    await context.models.holdout.getAllPayloadHoldouts(environment);
  const rampMonitoredRuleMap =
    await context.models.rampSchedules.getPayloadRampMonitoredRuleMap();

  return buildSDKPayloadForConnection({
    context,
    connection: {
      capabilities: args.capabilities,
      environment,
      projects: projects ?? null,
      encryptPayload: args.encryptPayload,
      encryptionKey: args.encryptionKey,
      includeVisualExperiments: args.includeVisualExperiments,
      includeDraftExperiments: args.includeDraftExperiments,
      includeExperimentNames: args.includeExperimentNames,
      includeRedirectExperiments: args.includeRedirectExperiments,
      includeRuleIds: args.includeRuleIds,
      hashSecureAttributes: args.hashSecureAttributes,
      savedGroupReferencesEnabled: args.savedGroupReferencesEnabled,
      includeProjectIdInMetadata: args.includeProjectIdInMetadata,
      includeCustomFieldsInMetadata: args.includeCustomFieldsInMetadata,
      allowedCustomFieldsInMetadata: args.allowedCustomFieldsInMetadata,
      includeTagsInMetadata: args.includeTagsInMetadata,
      sessionReplayEnabled: args.sessionReplayEnabled,
    },
    data: {
      features: allFeatures,
      experimentMap,
      groupMap,
      safeRolloutMap,
      savedGroups: allSavedGroups,
      holdoutsMap,
      rampMonitoredRuleMap,
      constants: await getResolvableValues(context),
    },
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
  date = new Date(),
  safeRolloutMap,
  namespaces,
  organization,
  constants,
}: {
  feature: FeatureInterface;
  attributes: ArchetypeAttributeValues;
  groupMap: GroupMap;
  experimentMap: Map<string, ExperimentInterface>;
  environments: Environment[];
  revision: FeatureRevisionInterface;
  scrubPrerequisites?: boolean;
  skipRulesWithPrerequisites?: boolean;
  date?: Date;
  safeRolloutMap: Map<string, SafeRolloutInterface>;
  namespaces?: Map<
    string,
    { hashAttribute?: string; seed?: string; format?: "legacy" | "multiRange" }
  >;
  // Drives project-scoping intersect inside `getFeatureDefinition`; omitting
  // it leaks `allEnvironments: true` rules into project-scoped-out envs.
  organization?: OrganizationInterface;
  // When provided, `@const:` references are resolved so preview/test results
  // match what the SDK payload actually serves (same as generateFeaturesPayload).
  constants?: ConstantInterface[];
}) {
  const results: FeatureTestResult[] = [];
  const savedGroups = getSavedGroupsValuesFromGroupMap(groupMap);

  // change the NODE ENV so that we can get the debug log information:
  let switchEnv = false;
  if (process.env.NODE_ENV === "production") {
    process.env = {
      ...process.env,
      NODE_ENV: "development",
    };
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
      const envConstantMap = constants?.length
        ? buildConstantValueMap(constants, env.id)
        : null;
      const definition = getFeatureDefinition({
        feature,
        groupMap,
        experimentMap,
        environment: env.id,
        revision,
        date,
        safeRolloutMap,
        namespaces: namespaces,
        organization,
        // Resolves `@const:` references so the preview matches the served
        // payload. Cycles are left unresolved (rendered as-is), same as payload
        // generation — no logging needed in this preview-only path.
        constantMap: envConstantMap ?? undefined,
      });

      if (definition) {
        // Prerequisite scrubbing:
        const rulesWithPrereqs: FeatureDefinitionRule[] = [];
        if (scrubPrerequisites) {
          definition.rules = definition.rules
            ? definition?.rules
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
                .filter(isDefined)
            : undefined;
        }

        thisEnvResult.featureDefinition = definition;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const log: [string, any][] = [];
        const gb = new GrowthBook({
          features: {
            [feature.id]: definition,
          },
          savedGroups: savedGroups,
          attributes: attributes ? attributes : {},
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
    process.env = {
      ...process.env,
      NODE_ENV: "production",
    };
  }
  return results;
}

export async function evaluateAllFeatures({
  features,
  context,
  attributeValues,
  environments,
  groupMap,
  safeRolloutMap,
}: {
  features: FeatureInterface[];
  context: ReqContext | ApiReqContext;
  attributeValues: ArchetypeAttributeValues;
  groupMap: GroupMap;
  environments?: (Environment | undefined)[];
  safeRolloutMap: Map<string, SafeRolloutInterface>;
}) {
  const results: { [key: string]: FeatureTestResult }[] = [];
  const savedGroups = getSavedGroupsValuesFromGroupMap(groupMap);

  const allFeaturesRaw = await getAllFeatures(context);
  const constants = await getResolvableValues(context);
  const allFeatures: Record<string, FeatureDefinition> = {};
  if (allFeaturesRaw.length) {
    allFeaturesRaw.map((f) => {
      allFeatures[f.id] = {
        ...f,
        project: f.project,
      } as FeatureDefinition;
    });
  }
  // get all features definitions
  const experimentMap = await getAllPayloadExperiments(context);
  // I could loop through the feature's defined environments, but if environments change in the org,
  // the values in the feature will be wrong.
  if (!environments || environments.length === 0) {
    return;
  }

  // change the NODE ENV so that we can get the debug log information:
  let switchEnv = false;
  if (process.env.NODE_ENV === "production") {
    process.env = {
      ...process.env,
      NODE_ENV: "development",
    };
    switchEnv = true;
  }

  for (const env of environments) {
    if (!env) {
      continue;
    }
    const holdoutsMap = await context.models.holdout.getAllPayloadHoldouts(
      env.id,
    );

    const featureDefinitions = generateFeaturesPayload({
      features: allFeaturesRaw,
      environment: env.id,
      experimentMap,
      groupMap,
      constants,
      prereqStateCache: {},
      safeRolloutMap,
      holdoutsMap,
      organization: context.org,
    });

    // now we have all the definitions, lets evaluate them
    const gb = new GrowthBook({
      features: featureDefinitions,
      savedGroups: savedGroups,
      attributes: attributeValues,
    });
    gb.debug = true;

    // now loop through all features to eval them:
    for (const feature of features) {
      const revision = await getRevision({
        context,
        organization: context.org.id,
        featureId: feature.id,
        feature,
        version: parseInt(feature.version.toString()),
      });
      if (!revision) {
        if (switchEnv) {
          // change the NODE ENV back
          process.env = {
            ...process.env,
            NODE_ENV: "production",
          };
        }
        throw new Error("Could not find feature revision");
      }
      const thisFeatureEnvResult: FeatureTestResult = {
        env: env.id,
        result: null,
        enabled: false,
        defaultValue: revision.defaultValue,
      };
      if (featureDefinitions[feature.id]) {
        const settings = feature.environmentSettings[env.id] ?? null;
        if (settings) {
          thisFeatureEnvResult.enabled = settings.enabled;
        }
        const log: [string, Record<string, unknown>][] = [];
        // set the log for this feature so to avoid overwriting the log from other features
        gb.log = (msg, ctx) => {
          log.push([msg, ctx]);
        };
        // eval the feature
        thisFeatureEnvResult.result = gb.evalFeature(feature.id);
        thisFeatureEnvResult.log = log;
      }
      results.push({ [feature.id]: thisFeatureEnvResult });
    }
    gb.destroy();
  }
  if (switchEnv) {
    // change the NODE ENV back
    process.env = {
      ...process.env,
      NODE_ENV: "production",
    };
  }
  return results;
}

export function generateRuleId() {
  return uniqid("fr_");
}

// Sorted-key JSON; mirrors `JSON.stringify`'s undefined-dropping. Used for
// content hashing — insertion order must not change the digest.
function stableStringify(value: unknown): string {
  if (value === undefined) return "";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => stableStringify(v) || "null").join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const parts = keys.map(
    (k) => JSON.stringify(k) + ":" + (stableStringify(obj[k]) || "null"),
  );
  return "{" + parts.join(",") + "}";
}

// Deterministic id for legacy rules with no `id`. Hashes the rule sans id so
// the same content always yields the same id — replayable across reads and
// re-runs. Identical content across envs hashes identically, which is the
// merge-eligible case `flattenV1ToV2Rules` collapses; within-env duplicates
// fall through to its `dupInEnvIds` suffix path.
export function synthesizeRuleId(rule: object): string {
  const { id: _id, ...rest } = rule as { id?: unknown } & Record<
    string,
    unknown
  >;
  const json = stableStringify(rest);
  const hash = createHash("sha1").update(json).digest("hex").slice(0, 16);
  return `fr_h_${hash}`;
}

export function addIdsToRules(
  environmentSettings: Record<string, FeatureEnvironment> = {},
  featureId: string,
) {
  // Defensive: rules don't live under environmentSettings in v2, but stamp any
  // stray env.rules from legacy callers. `addIdsToFlatRules` is authoritative.
  Object.values(environmentSettings).forEach((env) => {
    const rules = (env as unknown as { rules?: FeatureRule[] }).rules;
    if (rules && rules.length) {
      rules.forEach((r) => {
        if (r.type === "experiment" && !r?.trackingKey) {
          r.trackingKey = featureId;
        }
        if (!r.id) {
          r.id = generateRuleId();
        }
        if (r.type === "rollout" && !r.seed) {
          r.seed = r.id;
        }
      });
    }
  });
}

export function addIdsToFlatRules(
  rules: FeatureRule[] = [],
  featureId: string,
): void {
  rules.forEach((r) => {
    if (r.type === "experiment" && !r?.trackingKey) {
      r.trackingKey = featureId;
    }
    if (!r.id) {
      r.id = generateRuleId();
    }
    // Rollout rules without an explicit seed default to their rule ID.
    // This ensures the SDK (which falls back to rule.id when no seed is sent)
    // and the monitored-ramp payload both bucket users identically, preventing
    // variation hopping when a rule transitions between monitored/unmonitored.
    if (r.type === "rollout" && !r.seed) {
      r.seed = r.id;
    }
  });
}

export function arrayMove<T>(
  array: Array<T>,
  from: number,
  to: number,
): Array<T> {
  const newArray = array.slice();
  newArray.splice(
    to < 0 ? newArray.length + to : to,
    0,
    newArray.splice(from, 1)[0],
  );
  return newArray;
}

export function verifyDraftsAreEqual(
  actual?: FeatureDraftChanges,
  expected?: FeatureDraftChanges,
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
      },
    )
  ) {
    throw new Error(
      "New changes have been made to this feature. Please review and try again.",
    );
  }
}

export async function encrypt(
  plainText: string,
  keyString: string | undefined,
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
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-CBC",
      iv,
    },
    key,
    new TextEncoder().encode(plainText),
  );
  return (
    // FIXME: This cast was added when we upgraded to TS 5.7, and we wanted to avoid changing runtime behavior.
    // We might want to investigate a more robust solution in the future.
    bufToBase64(iv as unknown as ArrayBuffer) +
    "." +
    bufToBase64(encryptedBuffer)
  );
}

function eventUserToString(
  user: FeatureRevisionInterface["createdBy"],
): string | undefined {
  if (!user) return undefined;
  if (user.type === "api_key") return "API";
  if (user.type === "system") return "SYSTEM";
  return user.name || undefined;
}

// API-safe projection of the internal EventUser union. Deliberately never
// exposes the api_key actor's `apiKey` field — only stable identifying fields.
export function eventUserToApiEventUser(
  user: FeatureRevisionInterface["createdBy"] | undefined,
): ApiEventUser | undefined {
  if (!user) return undefined;
  switch (user.type) {
    case "dashboard":
      return {
        type: "dashboard",
        id: user.id,
        name: user.name,
        email: user.email,
      };
    case "api_key":
      return {
        type: "api_key",
        id: user.id,
        name: user.name,
        email: user.email,
      };
    case "system":
      return {
        type: "system",
        id: user.id,
      };
  }
  // Fail closed for legacy stored documents with an unrecognized type.
  return undefined;
}

export function normalizeRuleForApi(rule: FeatureRule): ApiFeatureRule {
  const base = {
    description: rule.description,
    // REST emits the fully qualified id (with any `__<env>` suffix).
    // Mutation endpoints enforce exact id matching, so stem-stripping here
    // would break PUT/DELETE round-trips. SDK payloads stem-strip instead;
    // see `getFeatureDefinition`.
    id: rule.id,
    condition: rule.condition || "",
    enabled: !!rule.enabled,
    scheduleRules: rule.scheduleRules,
    scheduleType: rule.scheduleType,
    savedGroupTargeting: (rule.savedGroups || []).map((s) => ({
      matchType: s.match,
      savedGroups: s.ids,
    })),
    prerequisites: rule.prerequisites || [],
  };
  switch (rule.type) {
    case "force":
      return { ...base, type: "force", value: rule.value, sparse: rule.sparse };
    case "rollout":
      return {
        ...base,
        type: "rollout",
        value: rule.value,
        sparse: rule.sparse,
        coverage: rule.coverage ?? 1,
        hashAttribute: rule.hashAttribute,
        seed: rule.seed,
      };
    case "experiment":
      return {
        ...base,
        type: "experiment",
        coverage: rule.coverage ?? 1,
        trackingKey: rule.trackingKey,
        hashAttribute: rule.hashAttribute,
        fallbackAttribute: rule.fallbackAttribute,
        disableStickyBucketing: rule.disableStickyBucketing,
        bucketVersion: rule.bucketVersion,
        minBucketVersion: rule.minBucketVersion,
        namespace: toApiNamespace(rule.namespace),
        value: rule.values,
      };
    case "experiment-ref":
      return {
        ...base,
        type: "experiment-ref",
        variations: rule.variations,
        experimentId: rule.experimentId,
        sparse: rule.sparse,
      };
    case "contextual-bandit-ref":
      return {
        ...base,
        type: "contextual-bandit-ref",
        variations: rule.variations,
        contextualBanditId: rule.contextualBanditId,
      };
    case "safe-rollout":
      return {
        ...base,
        type: "safe-rollout",
        controlValue: rule.controlValue,
        variationValue: rule.variationValue,
        seed: rule.seed,
        hashAttribute: rule.hashAttribute,
        trackingKey: rule.trackingKey,
        safeRolloutId: rule.safeRolloutId,
        status: rule.status,
      };
  }
}

// Convenience wrapper that pulls the env list off the request context and
// the project off the (optional) parent feature.
export function toApiRevision(
  rev: FeatureRevisionInterface,
  ctx: ReqContext | ApiReqContext,
  feature?: FeatureInterface | null,
): z.infer<typeof apiFeatureRevisionValidator> {
  return revisionToApiInterface(
    rev,
    getEnvironments(ctx.org),
    feature?.project,
  );
}

// v1 REST response shape: per-env `rules: Record<env, ApiFeatureRule[]>`.
// Bucketing flows through `bucketRulesByEnv` (util/toLegacy); only the
// per-rule transform differs from the internal v1 projections.
export function revisionToApiInterface(
  rev: FeatureRevisionInterface,
  orgEnvs: Environment[],
  featureProject?: string,
): z.infer<typeof apiFeatureRevisionValidator> {
  const applicableEnvs = getApplicableEnvIds(orgEnvs, featureProject);
  const rules = bucketRulesByEnv(
    Array.isArray(rev.rules) ? rev.rules : undefined,
    applicableEnvs,
    normalizeRuleForApi,
  );

  return {
    featureId: rev.featureId,
    baseVersion: rev.baseVersion,
    version: rev.version,
    comment: rev.comment || "",
    date:
      rev.dateCreated?.toISOString?.() ||
      new Date(rev.dateCreated).toISOString(),
    status: rev.status,
    createdBy: eventUserToString(rev.createdBy),
    publishedBy: eventUserToString(rev.publishedBy),
    defaultValue: rev.defaultValue,
    rules,
    ...(rev.environmentsEnabled !== undefined && {
      environmentsEnabled: rev.environmentsEnabled,
    }),
    ...(rev.prerequisites !== undefined && {
      prerequisites: rev.prerequisites,
    }),
    ...(rev.metadata !== undefined && {
      metadata: {
        ...rev.metadata,
        jsonSchema: rev.metadata.jsonSchema
          ? {
              ...rev.metadata.jsonSchema,
              date:
                rev.metadata.jsonSchema.date?.toISOString?.() ||
                (rev.metadata.jsonSchema.date
                  ? new Date(rev.metadata.jsonSchema.date).toISOString()
                  : undefined),
            }
          : undefined,
      },
    }),
    ...(rev.rampActions !== undefined && {
      rampActions: rev.rampActions,
    }),
  };
}

// ---- V2 serializers ----

// v2 API rule shape: v1 fields + `allEnvironments` / `environments` scope.
// v2 read transform: split a stored (possibly config-backed) value into the
// API's `{ value, config }` pair. `@config:` is an internal detail — the API
// exposes the config key + override patch, never the raw `$extends` directive.
// The config a value directly extends is the value's own `@config:` ref (a
// pure-patch value that relies on the feature's `baseConfig` reports null here —
// `baseConfig` is a separate field). A descendant layered on the value reports
// that descendant.
function decomposeConfigValue(stored: string | undefined): {
  value: string | undefined;
  config: string | null;
} {
  const config = getConfigBackingKey(stored);
  if (config === null) return { value: stored, config: null };
  return { value: getConfigBackingPatch(stored), config };
}

// Recursively drop the internal `@config:` `$extends` directive from a compiled
// SDK `definition` so the REST representation never exposes it — config backing
// is conveyed via the standalone `baseConfig`/`config` fields instead. `@const:`
// refs are left intact so the values stay round-trippable/upsertable (the REST
// list mirrors what you'd send back, not the fully-resolved SDK payload).
export function scrubConfigExtends<T>(node: T): T {
  if (Array.isArray(node)) {
    return node.map((n) => scrubConfigExtends(n)) as unknown as T;
  }
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      if (key === "$extends" && Array.isArray(val)) {
        const kept = val.filter(
          (r) => !(typeof r === "string" && r.startsWith("@config:")),
        );
        // Drop an emptied `$extends` entirely; keep any surviving `@const:` refs.
        if (kept.length) out[key] = kept;
      } else {
        out[key] = scrubConfigExtends(val);
      }
    }
    return out as unknown as T;
  }
  return node;
}

export function normalizeRuleForApiV2(rule: FeatureRule): ApiFeatureRuleV2 {
  const base = normalizeRuleForApi(rule);
  const scoped = {
    ...base,
    allEnvironments: rule.allEnvironments ?? true,
    ...(rule.environments !== undefined && { environments: rule.environments }),
  };

  // Split config-backing out of the raw value into a discrete `config` field so
  // callers never see the internal `$extends: ["@config:…"]` directive.
  // `@const:`-extended (non-config) values pass through untouched.
  if (scoped.type === "force" || scoped.type === "rollout") {
    const { value, config } = decomposeConfigValue(scoped.value);
    return {
      ...scoped,
      value: value ?? "",
      ...(config !== null && { config }),
    };
  }
  if (
    scoped.type === "experiment-ref" ||
    scoped.type === "contextual-bandit-ref"
  ) {
    return {
      ...scoped,
      variations: scoped.variations.map((v) => {
        const { value, config } = decomposeConfigValue(v.value);
        return {
          ...v,
          value: value ?? "",
          ...(config !== null && { config }),
        };
      }),
    };
  }
  return scoped;
}

// v2 exposes a flat `rules: FeatureRuleV2[]` array; each rule carries its
// own scope via `allEnvironments` / `environments`.
export function revisionToApiInterfaceV2(
  rev: FeatureRevisionInterface,
): z.infer<typeof apiFeatureRevisionV2Validator> {
  const rampActionsByRuleId = new Map<string, "create" | "detach">();
  for (const a of rev.rampActions ?? []) {
    if (a.mode === "create" || a.mode === "detach") {
      rampActionsByRuleId.set(a.ruleId, a.mode);
    }
  }

  const rules: ApiFeatureRuleV2[] = Array.isArray(rev.rules)
    ? rev.rules.map((rule) => {
        const base = normalizeRuleForApiV2(rule);
        const pendingRamp = rampActionsByRuleId.get(rule.id);
        return pendingRamp ? { ...base, pendingRamp } : base;
      })
    : [];

  const revDefault = decomposeConfigValue(rev.defaultValue);

  return {
    featureId: rev.featureId,
    baseVersion: rev.baseVersion,
    version: rev.version,
    comment: rev.comment || "",
    date:
      rev.dateCreated?.toISOString?.() ||
      new Date(rev.dateCreated).toISOString(),
    status: rev.status,
    createdBy: eventUserToApiEventUser(rev.createdBy),
    publishedBy: eventUserToApiEventUser(rev.publishedBy),
    defaultValue: revDefault.value,
    ...(revDefault.config !== null && {
      defaultValueConfig: revDefault.config,
    }),
    rules,
    ...(rev.environmentsEnabled !== undefined && {
      environmentsEnabled: rev.environmentsEnabled,
    }),
    ...(rev.prerequisites !== undefined && {
      // Strip internal condition field — v2 only exposes the flag ID.
      prerequisites: rev.prerequisites.map(({ id }) => ({ id })),
    }),
    ...(rev.metadata !== undefined && {
      metadata: {
        ...rev.metadata,
        jsonSchema: rev.metadata.jsonSchema
          ? {
              ...rev.metadata.jsonSchema,
              date:
                rev.metadata.jsonSchema.date?.toISOString?.() ||
                (rev.metadata.jsonSchema.date
                  ? new Date(rev.metadata.jsonSchema.date).toISOString()
                  : undefined),
            }
          : undefined,
      },
    }),
    ...(rev.rampActions !== undefined && {
      rampActions: rev.rampActions,
    }),
    ...(rev.autoPublishOnApproval !== undefined && {
      autoPublishOnApproval: rev.autoPublishOnApproval,
    }),
    ...((rev.scheduledPublishAt ?? null) !== null && {
      scheduledPublishAt: new Date(
        rev.scheduledPublishAt as Date,
      ).toISOString(),
    }),
    ...(rev.scheduledPublishLockEdits !== undefined && {
      scheduledPublishLockEdits: rev.scheduledPublishLockEdits,
    }),
    ...(rev.scheduledPublishLockOthers !== undefined && {
      scheduledPublishLockOthers: rev.scheduledPublishLockOthers,
    }),
    ...(rev.scheduledPublishBypassApproval !== undefined && {
      scheduledPublishBypassApproval: rev.scheduledPublishBypassApproval,
    }),
    ...(rev.scheduledPublishLastError !== undefined && {
      scheduledPublishLastError: rev.scheduledPublishLastError,
    }),
    ...(rev.reviews !== undefined && {
      reviews: rev.reviews.map((r) => {
        const user = eventUserToApiEventUser(r.user);
        return {
          userId: r.userId,
          ...(user !== undefined ? { user } : {}),
          status: r.status,
          timestamp:
            r.timestamp?.toISOString?.() || new Date(r.timestamp).toISOString(),
        };
      }),
    }),
  };
}

// Diffable subset of a revision: the content fields, stripped of
// lifecycle/identity metadata that always differs across revisions (version,
// baseVersion, status, comment, date, createdBy, publishedBy, featureId).
// What's left is exactly what the diff endpoint compares.
export function revisionToDiffableV2(
  rev: FeatureRevisionInterface,
): Record<string, unknown> {
  const api = revisionToApiInterfaceV2(rev) as Record<string, unknown>;
  const excluded = new Set([
    "featureId",
    "baseVersion",
    "version",
    "comment",
    "date",
    "status",
    "createdBy",
    "publishedBy",
    "definitions",
    "reviews",
    // Scheduling/auto-publish state isn't feature content — excluded so arming,
    // canceling, or a poller failure doesn't surface as a false diff.
    "autoPublishOnApproval",
    "scheduledPublishAt",
    "scheduledPublishLockEdits",
    "scheduledPublishLockOthers",
    "scheduledPublishBypassApproval",
    "scheduledPublishLastError",
  ]);
  const content: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(api)) {
    if (excluded.has(key)) continue;
    content[key] = val;
  }
  return content;
}

// Mirrors `toApiRevision` at call sites; v2 serialization is context-free.
export function toApiRevisionV2(
  rev: FeatureRevisionInterface,
): z.infer<typeof apiFeatureRevisionV2Validator> {
  return revisionToApiInterfaceV2(rev);
}

/**
 * v2 feature API shape: top-level flat `rules` array + `environments[env]`
 * containing only `enabled` / `defaultValue` / `definition` (no rules).
 */
export function getApiFeatureObjV2({
  feature,
  organization,
  groupMap,
  experimentMap,
  revision,
  revisions,
  safeRolloutMap,
  rampScheduleMap,
}: {
  feature: FeatureInterface;
  organization: OrganizationInterface;
  groupMap: GroupMap;
  experimentMap: Map<string, ExperimentInterface>;
  revision: FeatureRevisionInterface | null;
  revisions?: FeatureRevisionInterface[];
  safeRolloutMap: Map<string, SafeRolloutInterface>;
  rampScheduleMap?: Map<string, string>;
}): ApiFeatureWithRevisionsV2 {
  // `baseConfig` (Config mode) is a discrete field; `defaultValueConfig` is the
  // default's own extension (a descendant it patches, else null) — the exposed
  // `defaultValue` is the override patch, never the raw `@config:` directive.
  const { value: decomposedDefault, config: defaultValueConfig } =
    decomposeConfigValue(feature.defaultValue);
  const defaultValue = decomposedDefault ?? feature.defaultValue;
  const featureEnvironments: Record<string, ApiFeatureEnvironmentV2> = {};
  const environments = getEnvironmentIdsFromOrg(organization);

  environments.forEach((env) => {
    const envSettings = feature.environmentSettings?.[env];
    const enabled = !!envSettings?.enabled;
    const definition = getFeatureDefinition({
      feature,
      groupMap,
      experimentMap,
      environment: env,
      safeRolloutMap,
      organization,
    });
    featureEnvironments[env] = { enabled, defaultValue };
    if (definition) {
      // Scrub `@config:` so the `definition` matches the upsertable top-level fields.
      featureEnvironments[env].definition = JSON.stringify(
        scrubConfigExtends(definition),
      );
    }
  });

  const apiRules: ApiFeatureRuleV2[] = (feature.rules ?? []).map((rule) => {
    const normalized = normalizeRuleForApiV2(rule);
    const rampScheduleId =
      rampScheduleMap?.get(stemRuleId(rule.id ?? "")) ?? undefined;
    return rampScheduleId ? { ...normalized, rampScheduleId } : normalized;
  });

  const revisionDefs = revisions?.map(revisionToApiInterfaceV2);
  const baseConfig = feature.baseConfig ?? null;

  return {
    id: feature.id,
    description: feature.description || "",
    archived: !!feature.archived,
    dateCreated: feature.dateCreated.toISOString(),
    dateUpdated: feature.dateUpdated.toISOString(),
    defaultValue,
    ...(baseConfig !== null && { baseConfig }),
    ...(defaultValueConfig !== null && { defaultValueConfig }),
    rules: apiRules,
    environments: featureEnvironments,
    prerequisites: (feature?.prerequisites || []).map((p) => p.id),
    owner: feature.owner || "",
    project: feature.project || "",
    tags: feature.tags || [],
    valueType: feature.valueType,
    revision: {
      comment: revision?.comment || "",
      date: revision?.dateCreated.toISOString() || "",
      createdBy: eventUserToApiEventUser(revision?.createdBy),
      publishedBy: eventUserToApiEventUser(revision?.publishedBy),
      version: feature.version,
    },
    revisions: revisionDefs,
    customFields: feature.customFields ?? {},
    ...(feature.holdout != null ? { holdout: feature.holdout } : {}),
  };
}

export function getApiFeatureObj({
  feature,
  organization,
  groupMap,
  experimentMap,
  revision,
  revisions,
  safeRolloutMap,
}: {
  feature: FeatureInterface;
  organization: OrganizationInterface;
  groupMap: GroupMap;
  experimentMap: Map<string, ExperimentInterface>;
  revision: FeatureRevisionInterface | null;
  revisions?: FeatureRevisionInterface[];
  safeRolloutMap: Map<string, SafeRolloutInterface>;
}): ApiFeatureWithRevisions {
  // Scrub the internal `@config:` directive out of the exposed values and
  // surface config backing via `baseConfig`/`defaultValueConfig` instead
  // (mirrors the v2 REST shape; `@const:` refs are left intact). Shared by the
  // v1 REST endpoint and the feature webhook payload.
  const baseConfig = feature.baseConfig ?? null;
  const { value: decomposedDefault, config: defaultValueConfig } =
    decomposeConfigValue(feature.defaultValue);
  const defaultValue = decomposedDefault ?? feature.defaultValue;
  const featureEnvironments: Record<string, ApiFeatureEnvironment> = {};
  const environments = getEnvironmentIdsFromOrg(organization);
  // Raw spread + standard overrides. Preserves internal FeatureRule field
  // names (`values`, raw `namespace`, …) for `/api/v1/feature/:id`.
  // `revisionToApiInterface` uses `normalizeRuleForApi` instead, which renames
  // and reshapes; the two surfaces have always diverged.
  //
  // Defaults below mirror origin/main's long-standing explicit normalization.
  // The old typed sub-schema also auto-initialized `savedGroups`,
  // `scheduleRules`, and `variations` to `[]`; those leaked into the API
  // response by accident and are intentionally NOT re-introduced here — the
  // SDK payload (`definition`) is unaffected and external consumers should
  // null-check sparse rule fields.
  // Strip `@config:` from a rule value string; `@const:` refs pass through.
  const scrubValue = (v: string | undefined): string | undefined =>
    v === undefined ? v : (stripConfigExtends(v) ?? v);
  const normalizeRuleForFeatureEnv = (rule: FeatureRule): ApiFeatureRule =>
    ({
      ...rule,
      coverage:
        rule.type === "rollout" || rule.type === "experiment"
          ? (rule.coverage ?? 1)
          : 1,
      condition: rule.condition || "",
      savedGroupTargeting: (rule.savedGroups || []).map((s) => ({
        matchType: s.match,
        savedGroups: s.ids,
      })),
      prerequisites: rule.prerequisites || [],
      enabled: !!rule.enabled,
      // Scrub `@config:` from every value-bearing field of this rule type.
      ...("value" in rule && typeof rule.value === "string"
        ? { value: scrubValue(rule.value) }
        : {}),
      ...(rule.type === "experiment" && Array.isArray(rule.values)
        ? {
            values: rule.values.map((v) => ({
              ...v,
              value: scrubValue(v.value),
            })),
          }
        : {}),
      ...((rule.type === "experiment-ref" ||
        rule.type === "contextual-bandit-ref") &&
      Array.isArray(rule.variations)
        ? {
            variations: rule.variations.map((v) => ({
              ...v,
              value: scrubValue(v.value),
            })),
          }
        : {}),
      ...(rule.type === "safe-rollout"
        ? {
            controlValue: scrubValue(rule.controlValue),
            variationValue: scrubValue(rule.variationValue),
          }
        : {}),
    }) as unknown as ApiFeatureRule;
  // `applicableEnvs` scopes `allEnvironments: true` rules; seeding with
  // `environments` keeps every org env present in the response.
  const orgEnvs = getEnvironments(organization);
  const applicableEnvs = getApplicableEnvIds(orgEnvs, feature.project);
  const featureRulesByEnv = bucketRulesByEnv(
    feature.rules,
    applicableEnvs,
    normalizeRuleForFeatureEnv,
    environments,
  );
  environments.forEach((env) => {
    const envSettings = feature.environmentSettings?.[env];
    const enabled = !!envSettings?.enabled;
    const rules = featureRulesByEnv[env] ?? [];
    const definition = getFeatureDefinition({
      feature,
      groupMap,
      experimentMap,
      environment: env,
      safeRolloutMap,
      namespaces: namespacesToMap(organization.settings?.namespaces),
      organization,
    });

    featureEnvironments[env] = {
      enabled,
      defaultValue,
      rules: rules as ApiFeatureRule[],
    };
    if (definition) {
      featureEnvironments[env].definition = JSON.stringify(
        scrubConfigExtends(definition),
      );
    }
  });
  const createdBy =
    revision?.createdBy?.type === "api_key"
      ? "API"
      : revision?.createdBy?.type === "system"
        ? "SYSTEM"
        : revision?.createdBy?.name;
  const publishedBy =
    revision?.publishedBy?.type === "api_key"
      ? "API"
      : revision?.publishedBy?.type === "system"
        ? "SYSTEM"
        : revision?.publishedBy?.name;

  const revisionDefs = revisions?.map((rev) => {
    // Bucket twice: REST response shape (matches the feature env loop above)
    // and raw FeatureRule[] for SDK payload compilation below.
    const revRules = Array.isArray(rev?.rules) ? rev.rules : undefined;
    const revRulesByEnv = bucketRulesByEnv(
      revRules,
      applicableEnvs,
      normalizeRuleForFeatureEnv,
      environments,
    );
    const revRawRulesByEnv = bucketRulesByEnv(
      revRules,
      applicableEnvs,
      (r) => r,
      environments,
    );

    const environmentRules: Record<string, ApiFeatureRule[]> = {};
    const environmentDefinitions: Record<string, string> = {};
    environments.forEach((env) => {
      // Synthesize a v2 feature from the per-env slice — rules in the slice
      // already apply to `env`, so tag them `allEnvironments: true` to skip
      // re-projection inside `getFeatureDefinition`.
      const slicedRules: FeatureRule[] = (revRawRulesByEnv[env] ?? []).map(
        (r) => ({ ...r, allEnvironments: true, environments: undefined }),
      );
      const definition = getFeatureDefinition({
        feature: { ...feature, rules: slicedRules },
        groupMap,
        experimentMap,
        environment: env,
        safeRolloutMap,
        namespaces: namespacesToMap(organization.settings?.namespaces),
        organization,
      });

      environmentRules[env] = revRulesByEnv[env] ?? [];
      environmentDefinitions[env] = JSON.stringify(
        scrubConfigExtends(definition),
      );
    });
    const createdBy =
      rev?.createdBy?.type === "api_key"
        ? "API"
        : rev?.createdBy?.type === "system"
          ? "SYSTEM"
          : rev?.createdBy?.name;
    const publishedBy =
      rev?.publishedBy?.type === "api_key"
        ? "API"
        : rev?.publishedBy?.type === "system"
          ? "SYSTEM"
          : rev?.publishedBy?.name;
    return {
      featureId: rev.featureId,
      baseVersion: rev.baseVersion,
      version: rev.version,
      comment: rev?.comment || "",
      date: rev?.dateCreated.toISOString() || "",
      status: rev?.status,
      createdBy,
      publishedBy,
      rules: environmentRules,
      definitions: environmentDefinitions,
      defaultValue: stripConfigExtends(rev.defaultValue) ?? rev.defaultValue,
      ...(rev.environmentsEnabled !== undefined && {
        environmentsEnabled: rev.environmentsEnabled,
      }),
      ...(rev.prerequisites !== undefined && {
        prerequisites: rev.prerequisites,
      }),
      ...(rev.metadata !== undefined && {
        metadata: {
          ...rev.metadata,
          jsonSchema: rev.metadata.jsonSchema
            ? {
                ...rev.metadata.jsonSchema,
                date: rev.metadata.jsonSchema.date.toISOString(),
              }
            : undefined,
        },
      }),
    };
  });

  const featureRecord: ApiFeatureWithRevisions = {
    id: feature.id,
    description: feature.description || "",
    archived: !!feature.archived,
    dateCreated: feature.dateCreated.toISOString(),
    dateUpdated: feature.dateUpdated.toISOString(),
    defaultValue,
    ...(baseConfig !== null && { baseConfig }),
    ...(defaultValueConfig !== null && { defaultValueConfig }),
    environments: featureEnvironments,
    prerequisites: (feature?.prerequisites || []).map((p) => p.id),
    owner: feature.owner || "",
    project: feature.project || "",
    tags: feature.tags || [],
    valueType: feature.valueType,
    revision: {
      comment: revision?.comment || "",
      date: revision?.dateCreated.toISOString() || "",
      createdBy: createdBy || "",
      publishedBy: publishedBy || "",
      version: feature.version,
    },
    revisions: revisionDefs,
    customFields: feature.customFields ?? {},
    ...(feature.holdout != null ? { holdout: feature.holdout } : {}),
  };

  return featureRecord;
}

// Earliest future schedule-rule timestamp across `rules`, or null if none.
// Schedule rules live on the rule itself and aren't env-scoped.
export function getNextScheduledUpdate(
  rules: FeatureRule[] | undefined,
): Date | null {
  if (!rules || rules.length === 0) {
    return null;
  }

  const dates: string[] = [];
  rules.forEach((rule) => {
    if (rule?.scheduleRules) {
      rule.scheduleRules.forEach((scheduleRule) => {
        if (scheduleRule.timestamp !== null) {
          dates.push(scheduleRule.timestamp);
        }
      });
    }
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
  salt: string,
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
    {},
  );
}

// Specific hashing entrypoint for Experiment conditions
export function applyExperimentHashing(
  experiments: AutoExperiment[],
  attributes: SDKAttributeSchema,
  salt: string,
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

// Specific hashing entrypoint for SavedGroup objects
export function applySavedGroupHashing(
  savedGroups: SavedGroupInterface[],
  attributes: SDKAttributeSchema,
  salt: string,
): SavedGroupInterface[] {
  const clonedGroups = clone(savedGroups);
  clonedGroups.forEach((group) => {
    const attribute = attributes.find(
      (attr) => attr.property === group.attributeKey,
    );
    if (attribute) {
      group.values = hashStrings({
        obj: group.values,
        salt,
        attributes,
        attribute,
        doHash: shouldHash(attribute),
      });
    }
  });
  return clonedGroups;
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
    const newObj: {
      // eslint-disable-next-line
      obj: any;
      attribute?: SDKAttribute;
      doHash?: boolean;
    }[] = [];
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
      doHash = attribute ? shouldHash(attribute, key) : doHash;

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

function shouldHash(attribute: SDKAttribute, operator?: string) {
  return !!(
    attribute?.datatype &&
    ["secureString", "secureString[]"].includes(attribute?.datatype ?? "") &&
    (!operator || !["$inGroup", "$notInGroup"].includes(operator))
  );
}

export function sha256(str: string, salt: string): string {
  return createHash("sha256")
    .update(salt + str)
    .digest("hex");
}

// Validate every value a single rule carries against the feature's JSON schema
// (no-op when schema validation is disabled on the feature). Mirrors the
// per-type value fields the front-end `validateFeatureRule` covers.
export function validateFeatureRuleValues(
  feature: Pick<FeatureInterface, "valueType" | "jsonSchema">,
  rule: FeatureRule,
): void {
  switch (rule.type) {
    case "force":
    case "rollout":
      validateFeatureValue(feature, rule.value, "Value");
      break;
    case "experiment":
      (rule.values ?? []).forEach((v, i) =>
        validateFeatureValue(feature, v.value, `Variation ${i + 1}`),
      );
      break;
    case "experiment-ref":
      (rule.variations ?? []).forEach((v, i) =>
        validateFeatureValue(feature, v.value, `Variation ${i + 1}`),
      );
      break;
    case "safe-rollout":
      validateFeatureValue(feature, rule.controlValue, "Control value");
      validateFeatureValue(feature, rule.variationValue, "Variation value");
      break;
  }
}

// Enforce JSON-schema validation for a feature's default value and/or rule
// values. Validation is on by default; an explicit `?skipSchemaValidation=true`
// opts out (see context.skipSchemaValidation). Pass the EFFECTIVE feature —
// i.e. one already carrying the inbound/draft `jsonSchema`, `valueType`, so a
// request that changes the schema validates against the new schema.
export function assertFeatureValuesValid(
  context: ReqContext | ApiReqContext,
  feature: Pick<FeatureInterface, "valueType" | "jsonSchema">,
  values: { defaultValue?: string; rules?: FeatureRule[] },
): void {
  if (context.skipSchemaValidation) return;
  if (values.defaultValue !== undefined) {
    validateFeatureValue(feature, values.defaultValue, "Default value");
  }
  for (const rule of values.rules ?? []) {
    validateFeatureRuleValues(feature, rule);
  }
}

// Publish-time safety net: re-validate the values a revision is about to make
// live. Per-write validation already covers normal edits; this catches values
// that became invalid after the fact (staged with ?skipSchemaValidation, or
// before a schema change). When the org's `blockPublishOnSchemaError` is true
// (default) a mismatch blocks the publish; when false it's a bypassable soft
// warning.
// Collect the feature's own JSON-schema value errors WITHOUT throwing and
// WITHOUT the skipSchemaValidation early return — the caller decides how to
// weigh them (throw, or emit a publish gate). Shared by the throwing assert and
// the REST publish handler's gate collector.
export function collectFeatureValueErrorsForPublish(
  feature: Pick<FeatureInterface, "valueType" | "jsonSchema">,
  values: { defaultValue?: string; rules?: FeatureRule[] },
): string[] {
  const errors: string[] = [];
  const collect = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  };
  if (values.defaultValue !== undefined) {
    collect(() =>
      validateFeatureValue(feature, values.defaultValue!, "Default value"),
    );
  }
  for (const rule of values.rules ?? []) {
    collect(() => validateFeatureRuleValues(feature, rule));
  }
  return errors;
}

export function assertFeatureValuesValidForPublish(
  context: ReqContext | ApiReqContext,
  feature: Pick<FeatureInterface, "valueType" | "jsonSchema">,
  values: { defaultValue?: string; rules?: FeatureRule[] },
): void {
  if (context.skipSchemaValidation) return;

  const errors = collectFeatureValueErrorsForPublish(feature, values);
  if (!errors.length) return;

  // Default to blocking when the setting is absent.
  if (context.org.settings?.blockPublishOnSchemaError === false) {
    // Warn mode: a bypassable soft warning (?ignoreWarnings=true), consistent
    // with the rest of the publish flow.
    if (context.ignoreWarnings) return;
    throw new SoftWarningError(
      "Publishing values that don't match the feature's JSON schema:\n" +
        errors.join("\n"),
      errors,
    );
  }
  throw new BadRequestError(errors.join(", "));
}

export const fromApiEnvSettingsRulesToFeatureEnvSettingsRules = (
  context: ReqContext,
  feature: FeatureInterface,
  rules: ApiFeatureEnvSettingsRules,
  existingRules?: FeatureRule[],
): FeatureRule[] => {
  // Honor the opt-in `?skipSchemaValidation=true` escape hatch: drop the schema
  // so values are still normalized (parse / dirty-json) but not schema-checked.
  const valFeature = context.skipSchemaValidation
    ? { ...feature, jsonSchema: undefined }
    : feature;
  return rules.map((r) => {
    const conditionRes = validateCondition(r.condition);
    if (!conditionRes.success) {
      throw new Error(
        "Invalid targeting condition JSON: " + conditionRes.error,
      );
    }

    // Opt-in attribute registration check (org-level setting). Only validate
    // fields that changed so pre-existing violations don't block unrelated edits.
    const ruleWithAttrs = r as {
      hashAttribute?: string;
      fallbackAttribute?: string;
      condition?: string;
    };
    const existingRule = r.id
      ? existingRules?.find((er) => er.id === r.id)
      : undefined;
    assertRegisteredAttributes(
      context,
      {
        hashAttribute: ruleWithAttrs.hashAttribute,
        fallbackAttribute: ruleWithAttrs.fallbackAttribute,
        condition: ruleWithAttrs.condition,
      },
      "rule",
      existingRule
        ? {
            hashAttribute: (existingRule as { hashAttribute?: string })
              .hashAttribute,
            fallbackAttribute: (existingRule as { fallbackAttribute?: string })
              .fallbackAttribute,
            condition: existingRule.condition,
          }
        : undefined,
      feature.project,
    );

    switch (r.type) {
      case "experiment-ref": {
        const experimentRefRule: ExperimentRefRule = {
          // missing id will be filled in by addIdsToRules
          id: r.id ?? "",
          allEnvironments: false,
          type: r.type,
          enabled: r.enabled != null ? r.enabled : true,
          description: r.description ?? "",
          experimentId: r.experimentId,
          variations: r.variations.map((v) => ({
            variationId: v.variationId,
            value: validateFeatureValue(valFeature, v.value),
          })),
          ...(r.sparse !== undefined && { sparse: r.sparse }),
          ...(r.prerequisites && { prerequisites: r.prerequisites }),
          ...(r.scheduleRules && { scheduleRules: r.scheduleRules }),
        };
        return experimentRefRule;
      }
      case "experiment": {
        const values = r.values || r.value;
        if (!values) {
          throw new Error("Missing values");
        }
        // Validate each variation value against the schema (previously skipped).
        if (Array.isArray(values)) {
          values.forEach((v: { value: string }, i) =>
            validateFeatureValue(valFeature, v.value, `Variation ${i + 1}`),
          );
        }
        const experimentRule: ExperimentRule = {
          // missing id will be filled in by addIdsToRules
          id: r.id ?? "",
          allEnvironments: false,
          type: r.type,
          hashAttribute: r.hashAttribute ?? "",
          coverage: r.coverage,
          // missing tracking key will be filled in by addIdsToRules
          trackingKey: r.trackingKey ?? "",
          enabled: r.enabled != null ? r.enabled : true,
          description: r.description ?? "",
          values: values,
          ...(r.prerequisites && { prerequisites: r.prerequisites }),
          ...(r.scheduleRules && { scheduleRules: r.scheduleRules }),
        };
        return experimentRule;
      }
      case "force": {
        const forceRule: ForceRule = {
          // missing id will be filled in by addIdsToRules
          id: r.id ?? "",
          allEnvironments: false,
          type: r.type,
          description: r.description ?? "",
          value: validateFeatureValue(valFeature, r.value),
          condition: r.condition,
          savedGroups: (r.savedGroupTargeting || []).map((s) => ({
            ids: s.savedGroups,
            match: s.matchType,
          })),
          enabled: r.enabled != null ? r.enabled : true,
          ...(r.sparse !== undefined && { sparse: r.sparse }),
          ...(r.prerequisites && { prerequisites: r.prerequisites }),
          ...(r.scheduleRules && { scheduleRules: r.scheduleRules }),
        };
        return forceRule;
      }
      case "rollout": {
        const rolloutRule: RolloutRule = {
          // missing id will be filled in by addIdsToRules
          id: r.id ?? "",
          allEnvironments: false,
          type: r.type,
          coverage: r.coverage,
          description: r.description ?? "",
          hashAttribute: r.hashAttribute,
          value: validateFeatureValue(valFeature, r.value),
          condition: r.condition,
          savedGroups: (r.savedGroupTargeting || []).map((s) => ({
            ids: s.savedGroups,
            match: s.matchType,
          })),
          enabled: r.enabled != null ? r.enabled : true,
          ...(r.sparse !== undefined && { sparse: r.sparse }),
          ...(r.prerequisites && { prerequisites: r.prerequisites }),
          ...(r.scheduleRules && { scheduleRules: r.scheduleRules }),
        };
        return rolloutRule;
      }
      default: {
        const _exhaustive: never = r;
        throw new Error(
          `Unrecognized feature rule type: "${(_exhaustive as { type?: string }).type ?? "unknown"}"`,
        );
      }
    }
  });
};

// In v2, rules live exclusively on `feature.rules` (flat). The env-settings
// reducer only emits `{ enabled }`; rule construction (and the registered-
// attribute check) happens in `buildFeatureRulesFromApiEnvSettings` /
// `mapV2ApiRuleToFeatureRule` callers.
export const createInterfaceEnvSettingsFromApiEnvSettings = (
  feature: FeatureInterface,
  baseEnvs: Environment[],
  incomingEnvs: ApiFeatureEnvSettings,
): FeatureInterface["environmentSettings"] =>
  baseEnvs.reduce(
    (acc, e) => ({
      ...acc,
      [e.id]: {
        enabled: incomingEnvs?.[e.id]?.enabled ?? !!e.defaultState,
      },
    }),
    {} as Record<string, FeatureEnvironment>,
  );

export const updateInterfaceEnvSettingsFromApiEnvSettings = (
  feature: FeatureInterface,
  incomingEnvs: ApiFeatureEnvSettings,
): FeatureInterface["environmentSettings"] => {
  const existing = feature.environmentSettings;
  return Object.keys(incomingEnvs).reduce((acc, k) => {
    return {
      ...acc,
      [k]: {
        enabled: incomingEnvs[k].enabled ?? existing[k]?.enabled ?? false,
      },
    };
  }, existing);
};

// Build the v2 flat `feature.rules` from the API's per-env payload. Routes the
// per-env record through `normalizeRulesInputToV2` so content-identical rules
// (matched by id) across envs collapse into a single v2 rule with
// `environments: [...envs]` (or `allEnvironments: true` when applicable). The
// naive "stamp each as `environments: [env]`" path forced `ensureUniqueRuleIds`
// to suffix shared ids, breaking v1 round-trip semantics for clients that
// legitimately use the same rule id across envs.
//
// Rules without an id are stamped here (per env) before flattening, since
// `flattenV1ToV2Rules` skips id-less rules (they have no group key).
export const buildFeatureRulesFromApiEnvSettings = (
  context: ReqContext,
  feature: FeatureInterface,
  baseEnvs: Environment[],
  incomingEnvs: ApiFeatureEnvSettings,
): FeatureRule[] => {
  const rulesByEnv: Record<string, FeatureRule[]> = {};
  baseEnvs.forEach((e) => {
    const apiRules = incomingEnvs?.[e.id]?.rules;
    if (!apiRules) return;
    const converted = fromApiEnvSettingsRulesToFeatureEnvSettingsRules(
      context,
      feature,
      apiRules,
    );
    addIdsToFlatRules(converted, feature.id);
    rulesByEnv[e.id] = converted;
  });
  if (Object.keys(rulesByEnv).length === 0) return [];
  return normalizeRulesInputToV2(rulesByEnv, {
    orgEnvs: baseEnvs,
    featureProject: feature.project,
  });
};

function prerequisiteListsDiffer(
  next: FeaturePrerequisite[],
  original: FeaturePrerequisite[] | undefined,
): boolean {
  const orig = original ?? [];
  if (next.length !== orig.length) return true;
  for (let i = 0; i < next.length; i++) {
    if (
      next[i]?.id !== orig[i]?.id ||
      next[i]?.condition !== orig[i]?.condition
    )
      return true;
  }
  return false;
}

// Only keep features that are "on" or "conditional". For "on" features, remove any top level prerequisites
export const reduceFeaturesWithPrerequisites = (
  features: FeatureInterface[],
  environment: string,
  prereqStateCache: Record<string, PrerequisiteStateResult> = {},
): FeatureInterface[] => {
  const newFeatures: FeatureInterface[] = [];

  const featuresMap = new Map(features.map((f) => [f.id, f]));

  // block "always off" features, or remove "always on" prereqs
  for (const feature of features) {
    let removeFeature = false;

    const newPrerequisites: FeaturePrerequisite[] = [];
    for (const prereq of feature.prerequisites || []) {
      let state: PrerequisiteStateResult = {
        state: "deterministic",
        value: null,
      };
      if (prereqStateCache[prereq.id]) {
        state = prereqStateCache[prereq.id];
      } else {
        const prereqFeature = featuresMap.get(prereq.id);
        if (prereqFeature) {
          state = evaluatePrerequisiteState(
            prereqFeature,
            featuresMap,
            environment,
            undefined,
            true,
          );
        }
        prereqStateCache[prereq.id] = state;
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
            prereq.condition,
          );
          if (evaled === "fail") {
            removeFeature = true;
          }
          break;
        }
      }
    }
    if (removeFeature) continue;

    const prerequisitesChanged = prerequisiteListsDiffer(
      newPrerequisites,
      feature.prerequisites,
    );

    // Block "always off" rules and reduce "always on" rules for this env.
    // Rules scoped to other envs are carried through verbatim.
    const existingRules = feature.rules ?? [];
    const newFeatureRules: FeatureRule[] = [];

    for (const rule of existingRules) {
      if (!ruleAppliesToEnv(rule, environment)) {
        newFeatureRules.push(rule);
        continue;
      }
      const { removeRule, newPrerequisites: rulePrereqs } =
        getInlinePrerequisitesReductionInfo(
          rule.prerequisites || [],
          featuresMap,
          environment,
          prereqStateCache,
        );
      if (removeRule) {
        continue;
      }
      const rulePrereqsChanged = prerequisiteListsDiffer(
        rulePrereqs,
        rule.prerequisites,
      );
      if (rulePrereqsChanged) {
        newFeatureRules.push({ ...rule, prerequisites: rulePrereqs });
      } else {
        newFeatureRules.push(rule);
      }
    }

    const rulesChanged =
      newFeatureRules.length !== existingRules.length ||
      newFeatureRules.some((r, i) => r !== existingRules[i]);

    if (!prerequisitesChanged && !rulesChanged) {
      newFeatures.push(feature);
      continue;
    }

    newFeatures.push({
      ...feature,
      ...(prerequisitesChanged && { prerequisites: newPrerequisites }),
      ...(rulesChanged && { rules: newFeatureRules }),
    });
  }

  return newFeatures;
};

export const reduceExperimentsWithPrerequisites = <
  T extends { experiment: ExperimentInterface },
>(
  experiments: T[],
  features: FeatureInterface[],
  environment: string,
  savedGroups: SavedGroupsValues,
  prereqStateCache: Record<string, PrerequisiteStateResult> = {},
): T[] => {
  const featuresMap = new Map(features.map((f) => [f.id, f]));

  const newExperiments: T[] = [];
  for (const data of experiments) {
    const phaseIndex = data.experiment.phases.length - 1;
    const phase: ExperimentPhase | null =
      data.experiment.phases?.[phaseIndex] ?? null;
    if (!phase) continue;
    const newData = cloneDeep(data);

    const { removeRule, newPrerequisites } =
      getInlinePrerequisitesReductionInfo(
        phase.prerequisites || [],
        featuresMap,
        environment,
        prereqStateCache,
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
  prereqStateCache: Record<string, PrerequisiteStateResult> = {},
): {
  removeRule: boolean;
  newPrerequisites: FeaturePrerequisite[];
} => {
  let removeRule = false;
  const newPrerequisites: FeaturePrerequisite[] = [];

  for (const pc of prerequisites) {
    const prereqFeature = featuresMap.get(pc.id);
    let state: PrerequisiteStateResult = {
      state: "deterministic",
      value: null,
    };
    if (prereqStateCache[pc.id]) {
      state = prereqStateCache[pc.id];
    } else {
      if (prereqFeature) {
        state = evaluatePrerequisiteState(
          prereqFeature,
          featuresMap,
          environment,
          undefined,
          true,
        );
      }
      prereqStateCache[pc.id] = state;
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
          pc.condition,
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

export async function getDraftRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  version: number,
): Promise<FeatureRevisionInterface> {
  // This is the published version, create a new draft revision
  const { org } = context;
  if (version === feature.version) {
    const newRevision = await createRevision({
      context,
      feature,
      user: context.auditUser,
      environments: getEnvironmentIdsFromOrg(context.org),
      baseVersion: version,
      org,
    });

    return newRevision;
  }

  // If this is already a draft, return it
  const revision = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
    version,
  });
  if (!revision) {
    throw new Error("Cannot find revision");
  }
  if (
    !(
      revision.status === "draft" ||
      revision.status === "pending-review" ||
      revision.status === "changes-requested" ||
      revision.status === "approved"
    )
  ) {
    throw new Error("Can only make changes to draft revisions");
  }

  return revision;
}

export async function getLiveRevisionForFeature(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
): Promise<FeatureRevisionInterface> {
  const live = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
    version: feature.version,
  });
  if (!live) {
    throw new Error(`Could not find live revision for feature ${feature.id}`);
  }
  return live;
}

export async function getLiveAndBaseRevisionsForFeature({
  context,
  feature,
  revision,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
}): Promise<{
  live: FeatureRevisionInterface;
  base: FeatureRevisionInterface;
}> {
  const live = await getLiveRevisionForFeature(context, feature);

  const base =
    revision.baseVersion === live.version
      ? live
      : await getRevision({
          context,
          organization: feature.organization,
          featureId: feature.id,
          feature,
          version: revision.baseVersion,
        });
  if (!base) {
    throw new Error("Could not lookup feature history");
  }

  return { live, base };
}

/**
 * Returns the env list to permission-check publish against. Global field
 * changes (defaultValue, prerequisites, archived, metadata) widen to all
 * enabled envs; holdout assignment widens to each transitioning holdout's
 * enabled envs; per-env rule/toggle changes contribute only their envs.
 * Empty contributors fall back to all enabled envs (defensive).
 *
 * Ramp actions intentionally not included — rule diffs cover them, and
 * rule-less ramp-only drafts hit the all-enabled fallback.
 */
export async function getMergeResultPublishEnvs({
  context,
  feature,
  filledLiveRules,
  result,
  environmentIds,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  filledLiveRules: FeatureRule[];
  result: MergeResultChanges;
  environmentIds: string[];
}): Promise<string[]> {
  const allEnabledEnvs = Array.from(
    getEnabledEnvironments(feature, environmentIds),
  );

  const hasGlobalChange =
    result.defaultValue !== undefined ||
    !!result.prerequisites ||
    result.archived !== undefined ||
    !!result.metadata;
  if (hasGlobalChange) return allEnabledEnvs;

  const changedRuleEnvs =
    result.rules === undefined
      ? []
      : environmentIds.filter(
          (env) =>
            !isEqual(
              getRulesForEnvironment(filledLiveRules, env),
              getRulesForEnvironment(result.rules!, env),
            ),
        );
  const changedToggleEnvs = Object.keys(result.environmentsEnabled || {});
  const holdoutEnvs = await collectHoldoutAffectedEnvs(
    context,
    feature,
    environmentIds,
    result.holdout,
  );

  const envScoped = Array.from(
    new Set([...changedRuleEnvs, ...changedToggleEnvs, ...holdoutEnvs]),
  );
  return envScoped.length > 0 ? envScoped : allEnabledEnvs;
}

// `undefined` = merge didn't touch holdout. Otherwise unions the active
// envs of the prior (when changing/clearing) and incoming holdouts.
async function collectHoldoutAffectedEnvs(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  environmentIds: string[],
  newHoldout: { id: string; value: string } | null | undefined,
): Promise<string[]> {
  if (newHoldout === undefined) return [];

  const envs = new Set<string>();
  const prevId = feature.holdout?.id;
  if (prevId && prevId !== newHoldout?.id) {
    const prev = await context.models.holdout.getById(prevId);
    if (prev) {
      getEnabledHoldoutEnvironments(prev, environmentIds).forEach((e) =>
        envs.add(e),
      );
    }
  }
  if (newHoldout?.id) {
    const next = await context.models.holdout.getById(newHoldout.id);
    if (next) {
      getEnabledHoldoutEnvironments(next, environmentIds).forEach((e) =>
        envs.add(e),
      );
    }
  }
  return [...envs];
}

// Whether a draft requires approval before publishing (org review settings, env
// scoping, license). When the base can't be resolved the answer is ambiguous:
// the default treats it as a no-approval change (false), but pass
// `treatUnresolvedBaseAsReview` to fail closed (true) for flows that commit
// locks/schedules and must not engage them on a draft that can't be evaluated.
export async function revisionRequiresReview(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  draft: FeatureRevisionInterface,
  {
    treatUnresolvedBaseAsReview = false,
  }: { treatUnresolvedBaseAsReview?: boolean } = {},
): Promise<boolean> {
  const allEnvironments = getEnvironmentIdsFromOrg(context.org);

  const baseRevision = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
    version: draft.baseVersion,
  });
  if (!baseRevision) return treatUnresolvedBaseAsReview;

  return checkIfRevisionNeedsReview({
    feature,
    baseRevision,
    revision: draft,
    allEnvironments,
    settings: context.org.settings,
    requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
  });
}

// Throws if the draft requires approval and the caller cannot bypass.
export async function assertCanAutoPublish(
  context: ReqContext,
  feature: FeatureInterface,
  draft: FeatureRevisionInterface,
): Promise<void> {
  const requiresReview = await revisionRequiresReview(context, feature, draft);

  if (requiresReview && !context.permissions.canBypassApprovalChecks(feature)) {
    context.permissions.throwPermissionError();
  }
}
