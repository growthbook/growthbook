import mongoose from "mongoose";
import uniqid from "uniqid";
import { z } from "zod";
import { isEqual, omit } from "lodash";
import { ApiSdkConnection } from "back-end/types/openapi";
import {
  managedByValidator,
  ManagedBy,
} from "back-end/src/validators/managed-by";
import {
  CreateSDKConnectionParams,
  EditSDKConnectionParams,
  ProxyConnection,
  ProxyTestResult,
  SDKConnectionInterface,
  SDKLanguage,
} from "back-end/types/sdk-connection";
import { cancellableFetch } from "back-end/src/util/http.util";
import {
  IS_CLOUD,
  PROXY_ENABLED,
  PROXY_HOST_INTERNAL,
  PROXY_HOST_PUBLIC,
} from "back-end/src/util/secrets";
import { errorStringFromZodResult } from "back-end/src/util/validation";
import { triggerSingleSDKWebhookJobs } from "back-end/src/jobs/updateAllJobs";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/organization";
import { addCloudSDKMapping } from "back-end/src/services/clickhouse";
import { refreshSDKPayloadCache } from "back-end/src/services/features";
import { logger } from "back-end/src/util/logger";
import { generateEncryptionKey, generateSigningKey } from "./ApiKeyModel";
import { getPayloadKeysForAllEnvs } from "./ExperimentModel";

const sdkConnectionSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: {
    type: String,
    index: true,
  },
  name: String,
  dateCreated: Date,
  dateUpdated: Date,
  languages: [String],
  sdkVersion: String,
  environment: String,
  project: String,
  projects: [String],
  encryptPayload: Boolean,
  encryptionKey: String,
  hashSecureAttributes: Boolean,
  includeVisualExperiments: Boolean,
  includeDraftExperiments: Boolean,
  includeExperimentNames: Boolean,
  includeRedirectExperiments: Boolean,
  includeRuleIds: Boolean,
  includeProjectPublicId: Boolean,
  includeCustomFields: [String],
  includeTags: [String],
  connected: Boolean,
  remoteEvalEnabled: Boolean,
  savedGroupReferencesEnabled: Boolean,
  eventTracker: String,
  managedBy: {},
  key: {
    type: String,
    unique: true,
  },
  proxy: {
    enabled: Boolean,
    host: String,
    hostExternal: String,
    signingKey: String,
    connected: Boolean,
    version: String,
    error: String,
    lastError: Date,
  },
});

type SDKConnectionDocument = mongoose.Document & SDKConnectionInterface;

const SDKConnectionModel = mongoose.model<SDKConnectionInterface>(
  "SdkConnection",
  sdkConnectionSchema,
);

function addEnvProxySettings(proxy: ProxyConnection): ProxyConnection {
  if (IS_CLOUD) return proxy;

  return {
    ...proxy,
    enabled: PROXY_ENABLED,
    host: PROXY_HOST_INTERNAL || PROXY_HOST_PUBLIC,
    hostExternal: PROXY_HOST_PUBLIC || PROXY_HOST_INTERNAL,
  };
}

function toInterface(doc: SDKConnectionDocument): SDKConnectionInterface {
  const conn = doc.toJSON<SDKConnectionDocument>();
  conn.proxy = addEnvProxySettings(conn.proxy);

  // Migrate old project setting to projects
  if (
    !conn.projects?.length &&
    (conn as SDKConnectionDocument & { project?: string }).project
  ) {
    const project = (conn as SDKConnectionDocument & { project: string })
      .project;
    conn.projects = [project];
    (conn as SDKConnectionDocument & { project?: string }).project = "";
  }

  return omit(conn, ["__v", "_id"]);
}

export async function findSDKConnectionById(
  context: ReqContext | ApiReqContext,
  id: string,
) {
  const doc = await SDKConnectionModel.findOne({
    id,
  });

  if (!doc) return null;

  const connection = toInterface(doc);
  return context.permissions.canReadMultiProjectResource(connection.projects)
    ? connection
    : null;
}

export async function findSDKConnectionsByOrganization(
  context: ReqContext | ApiReqContext,
) {
  const docs = await SDKConnectionModel.find({
    organization: context.org.id,
  });

  const connections = docs.map(toInterface);
  return connections.filter((conn) =>
    context.permissions.canReadMultiProjectResource(conn.projects),
  );
}

export async function _dangerousGetSdkConnectionsAcrossMultipleOrgs(
  organizationIds: string[],
) {
  const docs = await SDKConnectionModel.find({
    organization: { $in: organizationIds },
  });

  return docs.map(toInterface);
}

export async function findAllSDKConnectionsAcrossAllOrgs() {
  const docs = await SDKConnectionModel.find();
  return docs.map(toInterface);
}

export async function findSDKConnectionsById(context: ReqContext, id: string) {
  const doc = await SDKConnectionModel.findOne({
    organization: context.org.id,
    id,
  });
  return doc ? toInterface(doc) : null;
}

export async function findSDKConnectionsByIds(
  context: ReqContext,
  ids: string[],
) {
  const docs = await SDKConnectionModel.find({
    organization: context.org.id,
    id: { $in: ids },
  });
  return docs.map(toInterface);
}

export async function findSDKConnectionByKey(key: string) {
  const doc = await SDKConnectionModel.findOne({ key });
  return doc ? toInterface(doc) : null;
}

export const createSDKConnectionValidator = z
  .object({
    organization: z.string(),
    name: z.string(),
    languages: z.array(z.string()),
    sdkVersion: z.string().optional(),
    environment: z.string(),
    projects: z.array(z.string()),
    encryptPayload: z.boolean(),
    hashSecureAttributes: z.boolean().optional(),
    includeVisualExperiments: z.boolean().optional(),
    includeDraftExperiments: z.boolean().optional(),
    includeExperimentNames: z.boolean().optional(),
    includeRedirectExperiments: z.boolean().optional(),
    includeRuleIds: z.boolean().optional(),
    includeProjectPublicId: z.boolean().optional(),
    includeCustomFields: z.array(z.string()).optional(),
    includeTags: z.array(z.string()).optional(),
    proxyEnabled: z.boolean().optional(),
    proxyHost: z.string().optional(),
    remoteEvalEnabled: z.boolean().optional(),
    savedGroupReferencesEnabled: z.boolean().optional(),
    managedBy: managedByValidator.optional(),
  })
  .strict();

function generateSDKConnectionKey() {
  // IMPORTANT: we use the /^sdk-/ regex to match against this for incoming API requests
  // DO NOT CHANGE the prefix without also updating that
  return generateSigningKey("sdk-", 12);
}

export async function createSDKConnection(params: CreateSDKConnectionParams) {
  const { proxyEnabled, proxyHost, languages, ...otherParams } =
    createSDKConnectionValidator.parse(params);

  // TODO: if using a proxy, try to validate the connection
  const connection: SDKConnectionInterface = {
    ...otherParams,
    languages: languages as SDKLanguage[],
    id: uniqid("sdk_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
    encryptionKey: await generateEncryptionKey(),
    connected: false,
    // This is not for cryptography, it just needs to be long enough to be unique
    key: generateSDKConnectionKey(),
    proxy: addEnvProxySettings({
      enabled: !!proxyEnabled,
      host: proxyHost || "",
      hostExternal: proxyHost || "",
      signingKey: generateSigningKey(),
      connected: false,
      lastError: null,
      version: "",
      error: "",
    }),
  };

  if (connection.proxy.enabled) {
    if (connection.proxy.host) {
      const res = await testProxyConnection(connection, false);
      if (res) {
        connection.proxy.connected = !res.error;
        connection.proxy.version = res.version || "";
      }
    } else {
      connection.proxy.connected = true;
    }
  }

  const doc = await SDKConnectionModel.create(connection);

  if (IS_CLOUD) {
    await addCloudSDKMapping(connection);
  }

  return toInterface(doc);
}

export const editSDKConnectionValidator = z
  .object({
    name: z.string().optional(),
    languages: z.array(z.string()).optional(),
    sdkVersion: z.string().optional(),
    proxyEnabled: z.boolean().optional(),
    proxyHost: z.string().optional(),
    environment: z.string().optional(),
    projects: z.array(z.string()).optional(),
    encryptPayload: z.boolean().optional(),
    hashSecureAttributes: z.boolean().optional(),
    includeVisualExperiments: z.boolean().optional(),
    includeDraftExperiments: z.boolean().optional(),
    includeExperimentNames: z.boolean().optional(),
    includeRedirectExperiments: z.boolean().optional(),
    includeRuleIds: z.boolean().optional(),
    includeProjectPublicId: z.boolean().optional(),
    includeCustomFields: z.array(z.string()).optional(),
    includeTags: z.array(z.string()).optional(),
    remoteEvalEnabled: z.boolean().optional(),
    savedGroupReferencesEnabled: z.boolean().optional(),
    eventTracker: z.string().optional(),
  })
  .strict();

export async function editSDKConnection(
  context: ReqContext | ApiReqContext,
  connection: SDKConnectionInterface,
  updates: EditSDKConnectionParams,
) {
  const { proxyEnabled, proxyHost, languages, ...rest } =
    editSDKConnectionValidator.parse(updates);

  const otherChanges = {
    ...rest,
    languages: languages as SDKLanguage[],
  };

  let newProxy = {
    ...connection.proxy,
  };
  if (proxyEnabled !== undefined && proxyEnabled !== connection.proxy.enabled) {
    newProxy.enabled = proxyEnabled;
  }
  if (proxyHost !== undefined && proxyHost !== connection.proxy.host) {
    newProxy.host = proxyHost;

    if (addEnvProxySettings(newProxy).host) {
      const res = await testProxyConnection(
        {
          ...connection,
          proxy: addEnvProxySettings(newProxy),
        },
        false,
      );
      if (res) {
        newProxy.connected = !res.error;
        newProxy.version = res.version;
      }
    } else {
      newProxy.connected = true;
    }
  }
  newProxy = addEnvProxySettings(newProxy);

  // If we're changing the filter for which features are included, we should ping any
  // connected proxies to update their cache immediately instead of waiting for the TTL
  let needsProxyUpdate = false;
  const keysRequiringProxyUpdate = [
    "sdkVersion",
    "projects",
    "environment",
    "encryptPayload",
    "hashSecureAttributes",
    "remoteEvalEnabled",
    "includeVisualExperiments",
    "includeDraftExperiments",
    "includeExperimentNames",
    "includeRedirectExperiments",
    "includeRuleIds",
    "includeProjectPublicId",
    "includeCustomFields",
    "includeTags",
    "savedGroupReferencesEnabled",
  ] as const;
  keysRequiringProxyUpdate.forEach((key) => {
    if (key in otherChanges && !isEqual(otherChanges[key], connection[key])) {
      needsProxyUpdate = true;
    }
  });

  const fullChanges = {
    ...otherChanges,
    proxy: newProxy,
    project: "",
    dateUpdated: new Date(),
  };

  await SDKConnectionModel.updateOne(
    {
      organization: connection.organization,
      id: connection.id,
    },
    {
      $set: fullChanges,
    },
  );

  if (needsProxyUpdate) {
    // Purge CDN if used
    const isUsingProxy = !!(newProxy.enabled && newProxy.host);
    await triggerSingleSDKWebhookJobs(
      context,
      connection,
      otherChanges as Partial<SDKConnectionInterface>,
      newProxy,
      isUsingProxy,
    );
  }

  // Refresh SDK payload cache if includeCustomFields changed (affects payload metadata.customFields)
  if (
    "includeCustomFields" in otherChanges &&
    !isEqual(otherChanges.includeCustomFields, connection.includeCustomFields)
  ) {
    // Refresh cache for all environments since custom fields can be used across environments
    // If projects is empty, get all projects to ensure we refresh all environments
    const projectsToUse =
      connection.projects.length > 0
        ? connection.projects
        : (await context.models.projects.getAll()).map((p) => p.id);
    const payloadKeys = getPayloadKeysForAllEnvs(context, projectsToUse);
    refreshSDKPayloadCache(context, payloadKeys).catch((e) => {
      logger.error(
        e,
        "Error refreshing SDK payload cache after SDK connection custom fields update",
      );
    });
  }

  // Refresh SDK payload cache if includeTags changed (affects payload metadata.tags)
  if (
    "includeTags" in otherChanges &&
    !isEqual(otherChanges.includeTags, connection.includeTags)
  ) {
    // Refresh cache for all environments since tags can be used across environments
    // If projects is empty, get all projects to ensure we refresh all environments
    const projectsToUse =
      connection.projects.length > 0
        ? connection.projects
        : (await context.models.projects.getAll()).map((p) => p.id);
    const payloadKeys = getPayloadKeysForAllEnvs(context, projectsToUse);
    refreshSDKPayloadCache(context, payloadKeys).catch((e) => {
      logger.error(
        e,
        "Error refreshing SDK payload cache after SDK connection tags update",
      );
    });
  }

  return { ...connection, ...fullChanges };
}

export const updateSdkConnectionsRemoveManagedBy = async (
  context: ReqContext,
  managedBy: Partial<ManagedBy>,
) => {
  await SDKConnectionModel.updateMany(
    {
      organization: context.org.id,
      managedBy,
    },
    {
      $unset: {
        managedBy: 1,
      },
    },
  );
};

export async function deleteSDKConnectionById(
  organization: string,
  id: string,
) {
  await SDKConnectionModel.deleteOne({
    organization,
    id,
  });
}

export async function markSDKConnectionUsed(key: string) {
  await SDKConnectionModel.updateOne(
    { key },
    {
      $set: {
        connected: true,
      },
    },
  );
}

export async function setProxyError(
  connection: SDKConnectionInterface,
  error: string,
) {
  await SDKConnectionModel.updateOne(
    {
      organization: connection.organization,
      id: connection.id,
    },
    {
      $set: {
        "proxy.error": error,
        "proxy.connected": false,
        "proxy.lastError": new Date(),
      },
    },
  );
}

export async function clearProxyError(connection: SDKConnectionInterface) {
  await SDKConnectionModel.updateOne(
    {
      organization: connection.organization,
      id: connection.id,
    },
    {
      $set: {
        "proxy.error": "",
        "proxy.connected": true,
      },
    },
  );
}

export async function testProxyConnection(
  connection: SDKConnectionInterface,
  updateDB: boolean = true,
): Promise<ProxyTestResult | undefined> {
  const proxy = connection.proxy;
  if (!proxy || !proxy.enabled) {
    return {
      status: 0,
      body: "",
      error: "Proxy connection is not enabled",
      version: "",
      url: "",
    };
  }

  if (!proxy.host) {
    return;
  }

  const url = proxy.host.replace(/\/*$/, "") + "/healthcheck";
  let statusCode = 0,
    body = "";
  try {
    const { responseWithoutBody, stringBody } = await cancellableFetch(
      url,
      {
        method: "GET",
      },
      {
        maxTimeMs: 5000,
        maxContentSize: 500,
      },
    );
    statusCode = responseWithoutBody.status;
    body = stringBody;

    if (!responseWithoutBody.ok || !stringBody) {
      return {
        status: statusCode,
        body: body,
        error: "Proxy healthcheck returned a non-successful status code",
        version: "",
        url,
      };
    }

    const validator = z.object({
      proxyVersion: z.string(),
    });
    const res = validator.safeParse(JSON.parse(stringBody));
    if (!res.success) {
      throw new Error(errorStringFromZodResult(res));
    }

    const version = res.data.proxyVersion;

    if (updateDB) {
      await SDKConnectionModel.updateOne(
        {
          organization: connection.organization,
          id: connection.id,
        },
        {
          $set: {
            "proxy.connected": true,
            "proxy.version": version,
          },
        },
      );
    }

    return {
      status: statusCode,
      body: body,
      error: "",
      version,
      url,
    };
  } catch (e) {
    return {
      status: statusCode || 0,
      body: body || "",
      error:
        e?.code === "ECONNREFUSED"
          ? "Failed to connect to proxy server (ECONNREFUSED)"
          : e.message || "Failed to connect to proxy server",
      version: "",
      url,
    };
  }
}

export function toApiSDKConnectionInterface(
  connection: SDKConnectionInterface,
): ApiSdkConnection {
  return {
    id: connection.id,
    name: connection.name,
    organization: connection.organization,
    dateCreated: connection.dateCreated.toISOString(),
    dateUpdated: connection.dateUpdated.toISOString(),
    languages: connection.languages,
    sdkVersion: connection.sdkVersion,
    environment: connection.environment,
    project: connection.projects[0] || "",
    projects: connection.projects,
    encryptPayload: connection.encryptPayload,
    encryptionKey: connection.encryptionKey,
    hashSecureAttributes: connection.hashSecureAttributes,
    includeVisualExperiments: connection.includeVisualExperiments,
    includeDraftExperiments: connection.includeDraftExperiments,
    includeExperimentNames: connection.includeExperimentNames,
    includeRedirectExperiments: connection.includeRedirectExperiments,
    includeRuleIds: connection.includeRuleIds,
    includeProjectPublicId: connection.includeProjectPublicId,
    key: connection.key,
    proxyEnabled: connection.proxy.enabled,
    proxyHost: connection.proxy.host,
    proxySigningKey: connection.proxy.signingKey,
    remoteEvalEnabled: connection.remoteEvalEnabled,
  };
}
