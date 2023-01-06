import mongoose from "mongoose";
import uniqid from "uniqid";
import { z } from "zod";
import { SDKConnectionInterface } from "../../types/sdk-connection";
import { cancellableFetch } from "../events/handlers/webhooks/event-webhooks-utils";
import { generateEncryptionKey, generateSigningKey } from "./ApiKeyModel";

const sdkConnectionSchema = new mongoose.Schema({
  id: String,
  organization: String,
  description: String,
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
sdkConnectionSchema.index({ organization: 1, id: 1 }, { unique: true });

type SDKConnectionDocument = mongoose.Document & SDKConnectionInterface;

const SDKConnectionModel = mongoose.model<SDKConnectionDocument>(
  "SdkConnection",
  sdkConnectionSchema
);

function toInterface(doc: SDKConnectionDocument): SDKConnectionInterface {
  return doc.toJSON();
}

export async function findSDKConnectionById(organization: string, id: string) {
  const doc = await SDKConnectionModel.findOne({
    organization,
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

const createSDKConnectionValidator = z
  .object({
    organization: z.string(),
    description: z.string(),
    languages: z.array(z.string()),
    environment: z.string(),
    project: z.string(),
    encryptPayload: z.boolean(),
    proxyEnabled: z.boolean(),
    proxyHost: z.string(),
  })
  .strict();
export type CreateSDKConnectionParams = z.infer<
  typeof createSDKConnectionValidator
>;
export async function createSDKConnection(params: CreateSDKConnectionParams) {
  const {
    proxyEnabled,
    proxyHost,
    ...otherParams
  } = createSDKConnectionValidator.parse(params);

  // TODO: if using a proxy, try to validate the connection

  const doc = await SDKConnectionModel.create({
    ...otherParams,
    id: uniqid("sdk_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
    encryptionKey: generateEncryptionKey(),
    connected: false,
    proxy: {
      enabled: proxyEnabled,
      host: proxyHost,
      signingKey: generateSigningKey(),
      connected: false,
      lastHeartbeat: null,
      proxyVersion: "",
      error: "",
    },
  });

  return toInterface(doc);
}

const editSDKConnectionValidator = z
  .object({
    description: z.string().optional(),
    languages: z.array(z.string()).optional(),
    proxyEnabled: z.boolean().optional(),
    proxyHost: z.string().optional(),
  })
  .strict();
export type EditSDKConnectionParams = z.infer<
  typeof editSDKConnectionValidator
>;

export async function editSDKConnection(
  organization: string,
  id: string,
  updates: EditSDKConnectionParams
) {
  const {
    proxyEnabled,
    proxyHost,
    ...otherChanges
  } = editSDKConnectionValidator.parse(updates);

  const proxyChanges: {
    ["proxy.enabled"]?: boolean;
    ["proxy.host"]?: string;
  } = {};
  if (proxyEnabled !== undefined) {
    proxyChanges["proxy.enabled"] = proxyEnabled;
  }
  if (proxyHost !== undefined) {
    proxyChanges["proxy.host"] = proxyHost;
  }

  await SDKConnectionModel.updateOne(
    {
      organization,
      id,
    },
    {
      $set: {
        ...otherChanges,
        ...proxyChanges,
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

async function setProxyError(
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

export async function testProxyConnection(connection: SDKConnectionInterface) {
  const proxy = connection.proxy;
  if (!proxy || !proxy.enabled || !proxy.host) return;

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

  if (!responseWithoutBody.ok || !stringBody) {
    return await setProxyError(
      connection,
      stringBody || "Received status code " + responseWithoutBody.status
    );
  }

  try {
    // TODO: Is this the actual response format we want to use?
    const validator = z.object({
      proxyVersion: z.string(),
    });
    const json = validator.parse(JSON.parse(stringBody));

    await SDKConnectionModel.updateOne(
      {
        organization: connection.organization,
        id: connection.id,
      },
      {
        $set: {
          "proxy.connected": true,
          "proxy.proxyVersion": json.proxyVersion,
          "proxy.error": "",
          "proxy.lastError": null,
        },
      }
    );
  } catch (e) {
    await setProxyError(connection, `Invalid JSON response: ` + stringBody);
  }
}
