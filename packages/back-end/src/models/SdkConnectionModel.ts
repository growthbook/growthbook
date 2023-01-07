import mongoose from "mongoose";
import uniqid from "uniqid";
import { z } from "zod";
import {
  CreateSDKConnectionParams,
  EditSDKConnectionParams,
  SDKConnectionInterface,
  SDKLanguage,
} from "../../types/sdk-connection";
import { cancellableFetch } from "../events/handlers/webhooks/event-webhooks-utils";
import { errorStringFromZodResult } from "../util/validation";
import { generateEncryptionKey, generateSigningKey } from "./ApiKeyModel";

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
  environment: String,
  project: String,
  encryptPayload: Boolean,
  encryptionKey: String,
  connected: Boolean,
  key: {
    type: String,
    unique: true,
  },
  proxy: {
    enabled: Boolean,
    host: String,
    signingKey: String,
    connected: Boolean,
    proxyVersion: String,
    error: String,
    lastError: Date,
  },
});

type SDKConnectionDocument = mongoose.Document & SDKConnectionInterface;

const SDKConnectionModel = mongoose.model<SDKConnectionDocument>(
  "SdkConnection",
  sdkConnectionSchema
);

function toInterface(doc: SDKConnectionDocument): SDKConnectionInterface {
  return doc.toJSON();
}

export async function findSDKConnectionById(id: string) {
  const doc = await SDKConnectionModel.findOne({
    id,
  });
  return doc ? toInterface(doc) : null;
}

export async function findSDKConnectionsByOrganization(organization: string) {
  const docs = await SDKConnectionModel.find({
    organization,
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
    environment: z.string(),
    project: z.string(),
    encryptPayload: z.boolean(),
    proxyEnabled: z.boolean(),
    proxyHost: z.string(),
  })
  .strict();

function generateSDKConnectionKey() {
  // IMPORTANT: we use the /^sdk-/ regex to match against this for incoming API requests
  // DO NOT CHANGE the prefix without also updating that
  return generateSigningKey("sdk-", 12);
}

export async function createSDKConnection(params: CreateSDKConnectionParams) {
  const {
    proxyEnabled,
    proxyHost,
    languages,
    ...otherParams
  } = createSDKConnectionValidator.parse(params);

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
    proxy: {
      enabled: proxyEnabled,
      host: proxyHost,
      signingKey: generateSigningKey(),
      connected: false,
      lastError: null,
      proxyVersion: "",
      error: "",
    },
  };

  if (proxyEnabled && proxyHost) {
    const res = await testProxyConnection(connection, false);
    connection.proxy.connected = !res.error;
    connection.proxy.proxyVersion = res.version || "";
  }

  const doc = await SDKConnectionModel.create(connection);

  return toInterface(doc);
}

export const editSDKConnectionValidator = z
  .object({
    name: z.string().optional(),
    languages: z.array(z.string()).optional(),
    proxyEnabled: z.boolean().optional(),
    proxyHost: z.string().optional(),
  })
  .strict();

export async function editSDKConnection(
  connection: SDKConnectionInterface,
  updates: EditSDKConnectionParams
) {
  const {
    proxyEnabled,
    proxyHost,
    ...otherChanges
  } = editSDKConnectionValidator.parse(updates);

  const newProxy = {
    ...connection.proxy,
  };
  if (proxyEnabled !== undefined && proxyEnabled !== connection.proxy.enabled) {
    newProxy.enabled = proxyEnabled;
  }
  if (proxyHost !== undefined && proxyHost !== connection.proxy.host) {
    newProxy.host = proxyHost;

    const res = await testProxyConnection(
      {
        ...connection,
        proxy: newProxy,
      },
      false
    );
    newProxy.connected = !res.error;
    newProxy.proxyVersion = res.version;
  }

  await SDKConnectionModel.updateOne(
    {
      organization: connection.organization,
      id: connection.id,
    },
    {
      $set: {
        ...otherChanges,
        proxy: newProxy,
        dateUpdated: new Date(),
      },
    }
  );
}

export async function deleteSDKConnectionById(
  organization: string,
  id: string
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
    }
  );
}

export async function setProxyError(
  connection: SDKConnectionInterface,
  error: string
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
    }
  );
}

export async function testProxyConnection(
  connection: SDKConnectionInterface,
  updateDB: boolean = true
): Promise<{
  status: number;
  body: string;
  error: string;
  version: string;
}> {
  const proxy = connection.proxy;
  if (!proxy || !proxy.enabled || !proxy.host) {
    return {
      status: 0,
      body: "",
      error: "",
      version: "",
    };
  }
  let statusCode = 0,
    body = "";
  try {
    const { responseWithoutBody, stringBody } = await cancellableFetch(
      // TODO: Is this the real endpoint we want to use?
      proxy.host.replace(/\/*$/, "") + "/healthcheck",
      {
        method: "GET",
      },
      {
        maxTimeMs: 5000,
        maxContentSize: 500,
      }
    );
    statusCode = responseWithoutBody.status;
    body = stringBody;

    if (!responseWithoutBody.ok || !stringBody) {
      return {
        status: statusCode,
        body: body,
        error: "Proxy healthcheck returned a non-successful status code",
        version: "",
      };
    }

    // TODO: Is this the actual response format we want to use?
    const validator = z.object({
      proxyVersion: z.string(),
    });
    const res = validator.safeParse(JSON.parse(stringBody));
    if (!res.success) {
      throw new Error("Error: " + errorStringFromZodResult(res));
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
        }
      );
    }

    return {
      status: statusCode,
      body: body,
      error: "",
      version,
    };
  } catch (e) {
    return {
      status: statusCode || 0,
      body: body || "",
      error: e.message || "Failed to connect to Proxy server",
      version: "",
    };
  }
}
