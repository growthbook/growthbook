import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  getSavedGroupsValuesFromGroupMap,
  PrerequisiteStateResult,
} from "shared/util";
import {
  AutoExperimentWithProject,
  FeatureDefinitionWithProject,
} from "shared/types/sdk";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { ReqContext } from "../../types/request";
import { findSDKConnectionsByOrganization } from "../models/SdkConnectionModel";
import { SDKAttributeSchema } from "../../types/organization";
import { getAllSavedGroups } from "../models/SavedGroupModel";
import { getAllFeatures } from "../models/FeatureModel";
import {
  getAllPayloadExperiments,
  getAllURLRedirectExperiments,
  getAllVisualExperiments,
} from "../models/ExperimentModel";
import {
  fireGlobalSdkWebhooks,
  queueWebhooksForSdkConnection,
} from "../jobs/sdkWebhooks";
import { IS_CLOUD } from "../util/secrets";
import { queueSingleProxyUpdate } from "../jobs/proxyUpdate";
import {
  getSurrogateKeysFromEnvironments,
  purgeCDNCache,
} from "../util/cdn.util";
import { logger } from "../util/logger";
import { queueLegacySdkWebhooks } from "../jobs/webhooks";
import { SDKPayloadKey } from "../../types/sdk-payload";
import { updateSDKPayload } from "../models/SdkPayloadModel";
import { promiseAllChunks } from "../util/promise";
import {
  filterUsedSavedGroups,
  generateAutoExperimentsPayload,
  generateFeaturesPayload,
  generateHoldoutsPayload,
  getFeatureDefinitionsResponse,
  getSavedGroupMap,
} from "./features";

export async function triggerSdkPayloadRefresh({
  context,
  payloadKeys = [],
  sdkConnections: sdkConnectionsToUpdate = [],
}: {
  context: ReqContext;
  payloadKeys?: SDKPayloadKey[];
  sdkConnections?: SDKConnectionInterface[];
}): Promise<void> {
  // Get all SDK connections
  const sdkConnections = payloadKeys.length
    ? await findSDKConnectionsByOrganization(context)
    : sdkConnectionsToUpdate || [];

  //  SDK Connection ids that need to be refreshed
  // Also keep track of projects so we can limit what we fetch later
  const needsRefresh: SDKConnectionInterface[] = [];
  let filterByProjects = true;
  const projectsToRefresh: Set<string> = new Set();
  const environments: Set<string> = new Set();

  for (const sdkConnection of sdkConnections) {
    if (
      !sdkConnectionsToUpdate.some((conn) => conn.key === sdkConnection.key) &&
      !payloadKeys.some(
        ({ environment, project }) =>
          sdkConnection.environment === environment &&
          (sdkConnection.projects.length === 0 ||
            sdkConnection.projects.includes(project)),
      )
    ) {
      continue;
    }

    needsRefresh.push(sdkConnection);

    if (sdkConnection.projects.length === 0) {
      filterByProjects = false;
    } else {
      sdkConnection.projects.forEach((p) => projectsToRefresh.add(p));
    }

    environments.add(sdkConnection.environment);
  }

  if (!needsRefresh.length) {
    return;
  }

  // TODO: filter by projects
  const savedGroups = await getAllSavedGroups(context.org.id);
  const safeRolloutMap =
    await context.models.safeRollout.getAllPayloadSafeRollouts();
  const holdoutsMap = await context.models.holdout.getAllPayloadHoldouts();

  // Generate the feature definitions
  const features = await getAllFeatures(context, {
    projects: filterByProjects ? [...projectsToRefresh] : undefined,
  });
  const groupMap = await getSavedGroupMap(context.org, savedGroups);
  const experimentMap = await getAllPayloadExperiments(
    context,
    filterByProjects ? [...projectsToRefresh] : undefined,
  );

  const allVisualExperiments = await getAllVisualExperiments(
    context,
    experimentMap,
  );
  const allURLRedirectExperiments = await getAllURLRedirectExperiments(
    context,
    experimentMap,
  );

  const promises: (() => Promise<void>)[] = [];

  const featureDefinitionsByEnv: Record<
    string,
    Record<string, FeatureDefinitionWithProject>
  > = {};
  const expDefinitionsByEnv: Record<string, AutoExperimentWithProject[]> = {};

  environments.forEach((environment) => {
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
      safeRolloutMap,
      holdoutsMap,
    });
    featureDefinitionsByEnv[environment] = featureDefinitions;

    // Generate visual experiments
    const experimentsDefinitions = generateAutoExperimentsPayload({
      visualExperiments: allVisualExperiments,
      urlRedirectExperiments: allURLRedirectExperiments,
      groupMap,
      features,
      environment,
      prereqStateCache,
    });
    expDefinitionsByEnv[environment] = experimentsDefinitions;

    // TODO: remove this once we are fully transitioned to new per-connection cache
    if (payloadKeys.length > 0) {
      promises.push(async () => {
        const savedGroupsInUse = Object.keys(
          filterUsedSavedGroups(
            savedGroupValues,
            featureDefinitions,
            experimentsDefinitions,
          ),
        );

        logger.debug(
          `Updating SDK Payload for ${context.org.id} ${environment}`,
        );
        await updateSDKPayload({
          organization: context.org.id,
          environment: environment,
          featureDefinitions,
          holdoutFeatureDefinitions,
          experimentsDefinitions,
          savedGroupsInUse,
        });
      });
    }
  });

  const holdoutFeatureDefinitions = generateHoldoutsPayload({
    holdoutsMap,
  });

  const savedGroupValues = getSavedGroupsValuesFromGroupMap(groupMap);

  for (const connection of needsRefresh) {
    let attributes: SDKAttributeSchema | undefined = undefined;
    let secureAttributeSalt: string | undefined = undefined;
    if (connection.hashSecureAttributes) {
      // Note: We don't check for whether the org has the hash-secure-attributes premium feature here because
      // if they ever get downgraded for any reason we would be exposing secure attributes in the payload
      // which would expose private data publicly.
      secureAttributeSalt = context.org.settings?.secureAttributeSalt;
      attributes = context.org.settings?.attributeSchema;
    }

    const experimentsDefinitions = expDefinitionsByEnv[connection.environment];
    const featureDefinitions = featureDefinitionsByEnv[connection.environment];

    if (!featureDefinitions) {
      continue;
    }

    promises.push(async () => {
      const contents = await getFeatureDefinitionsResponse({
        features: featureDefinitions,
        experiments: experimentsDefinitions || [],
        holdouts: holdoutFeatureDefinitions,
        dateUpdated: new Date(),
        encryptionKey: connection.encryptionKey,
        includeVisualExperiments: connection.includeVisualExperiments,
        includeDraftExperiments: connection.includeDraftExperiments,
        includeExperimentNames: connection.includeExperimentNames,
        includeRedirectExperiments: connection.includeRedirectExperiments,
        includeRuleIds: connection.includeRuleIds,
        attributes,
        secureAttributeSalt,
        projects: connection.projects || [],
        capabilities: getConnectionSDKCapabilities(connection),
        savedGroups,
        savedGroupReferencesEnabled: connection.savedGroupReferencesEnabled,
        organization: context.org,
      });

      await context.models.sdkConnectionCache.upsert(
        connection.key,
        JSON.stringify(contents),
      );

      // New SDK Webhooks
      try {
        await queueWebhooksForSdkConnection(context, connection);
      } catch (e) {
        logger.error(e, "Error queueing webhooks");
      }

      // Proxy updates
      if (IS_CLOUD) {
        // Always fire webhook to GB Cloud Proxy for cloud users
        try {
          await queueSingleProxyUpdate(context.org.id, connection, true);
        } catch (e) {
          logger.error(e, "Error queueing cloud proxy update");
        }
      }
      // If connection (cloud or self-hosted) specifies an (additional) proxy host, fire webhook
      try {
        await queueSingleProxyUpdate(context.org.id, connection, false);
      } catch (e) {
        logger.error(e, "Error queueing proxy update");
      }
    });
  }

  if (!promises.length) return;

  // Execute promises in chunks to avoid overwhelming Mongo with big writes
  await promiseAllChunks(promises, 5);

  // Legacy SDK webhooks
  try {
    await queueLegacySdkWebhooks(context, payloadKeys, true);
  } catch (e) {
    logger.error(e, "Error queueing legacy SDK webhooks");
  }

  // Global SDK webhooks
  try {
    await fireGlobalSdkWebhooks(context, needsRefresh);
  } catch (e) {
    logger.error(e, "Error firing global SDK webhooks");
  }

  // Purge CDN cache
  try {
    await purgeCDNCache(context.org.id, [
      ...getSurrogateKeysFromEnvironments(
        context.org.id,
        Array.from(new Set(payloadKeys.map((k) => k.environment))),
      ),
      ...(sdkConnectionsToUpdate || []).map((conn) => conn.key),
    ]);
  } catch (e) {
    logger.error(e, "Error purging CDN cache for SDK connections");
  }
}
