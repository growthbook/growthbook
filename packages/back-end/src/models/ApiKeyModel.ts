import crypto from "crypto";
import { webcrypto } from "node:crypto";
import mongoose from "mongoose";
import uniqid from "uniqid";
import { ApiKeyInterface, SecretApiKey } from "shared/types/apikey";
import {
  IS_MULTI_ORG,
  SECRET_API_KEY,
  SECRET_API_KEY_ROLE,
} from "back-end/src/util/secrets";
import { roleForApiKey } from "back-end/src/util/api-key.util";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  ToInterface,
  getCollection,
  removeMongooseFields,
} from "back-end/src/util/mongo.util";
import { findAllOrganizations } from "./OrganizationModel.js";

const apiKeySchema = new mongoose.Schema({
  id: String,
  key: {
    type: String,
    unique: true,
  },
  environment: String,
  project: String,
  description: String,
  organization: {
    type: String,
    index: true,
  },
  dateCreated: Date,
  encryptSDK: Boolean,
  encryptionKey: String,
  secret: Boolean,
  role: {
    type: String,
    required: false,
  },
  userId: {
    type: String,
    required: false,
  },
});

const ApiKeyModel = mongoose.model<ApiKeyInterface>("ApiKey", apiKeySchema);
const COLLECTION = "apikeys";

const toInterface: ToInterface<ApiKeyInterface> = (doc) => {
  const obj = removeMongooseFields(doc);
  obj.role = roleForApiKey(obj) || undefined;
  return obj;
};

export async function generateEncryptionKey(): Promise<string> {
  const key = await webcrypto.subtle.generateKey(
    {
      name: "AES-CBC",
      length: 128,
    },
    true,
    ["encrypt", "decrypt"],
  );
  return Buffer.from(await webcrypto.subtle.exportKey("raw", key)).toString(
    "base64",
  );
}

function getShortEnvName(env: string) {
  env = env.toLowerCase();
  if (env.startsWith("dev")) return "dev";
  if (env.startsWith("local")) return "local";
  if (env.startsWith("staging")) return "staging";
  if (env.startsWith("stage")) return "stage";
  if (env.startsWith("qa")) return "qa";
  // Default to first 4 characters
  // Will work for "production" and "testing"
  return env.substring(0, 4);
}

export function generateSigningKey(prefix: string = "", bytes = 32): string {
  return (
    prefix + crypto.randomBytes(bytes).toString("base64").replace(/[=/+]/g, "")
  );
}

export async function createOrganizationApiKey({
  organizationId,
  description,
  role = "readonly",
}: {
  organizationId: string;
  description: string;
  role: "admin" | "readonly";
}): Promise<ApiKeyInterface> {
  return await createApiKey({
    organization: organizationId,
    secret: true,
    encryptSDK: false,
    description,
    environment: "",
    project: "",
    role,
  });
}

export async function createUserPersonalAccessApiKey({
  userId,
  organizationId,
  description,
}: {
  userId: string;
  organizationId: string;
  description: string;
}): Promise<ApiKeyInterface> {
  return await createApiKey({
    organization: organizationId,
    userId,
    secret: true,
    environment: "",
    project: "",
    encryptSDK: false,
    description,
    role: "user",
  });
}

export async function createUserVisualEditorApiKey({
  userId,
  organizationId,
  description,
}: {
  userId: string;
  organizationId: string;
  description: string;
}): Promise<ApiKeyInterface> {
  return await createApiKey({
    organization: organizationId,
    userId,
    secret: true,
    environment: "",
    project: "",
    encryptSDK: false,
    description,
    role: "visualEditor",
  });
}

/**
 * @deprecated
 */
export async function createLegacySdkKey({
  organizationId,
  environment,
  project,
  encryptSDK,
  description,
}: {
  organizationId: string;
  environment: string;
  project: string;
  encryptSDK: boolean;
  description: string;
}): Promise<ApiKeyInterface> {
  return await createApiKey({
    organization: organizationId,
    secret: false,
    environment,
    project,
    encryptSDK,
    description,
  });
}

/**
 * This lower-level function should not be exported.
 * Use either {@link createOrganizationApiKey} with role 'readonly' | 'admin' or {@link createLegacySdkKey}
 */
async function createApiKey({
  environment,
  project,
  organization,
  description,
  secret,
  encryptSDK,
  userId,
  role,
}: {
  environment: string;
  project: string;
  organization: string;
  description: string;
  secret: boolean;
  encryptSDK: boolean;
  userId?: string;
  role?: string;
}): Promise<ApiKeyInterface> {
  // NOTE: There's a plan to migrate SDK connection-related things to the SdkConnection collection
  if (!secret && !environment) {
    throw new Error("SDK Endpoints must have an environment set");
  }

  const prefix = prefixForApiKey({
    environment,
    secret,
    userId,
    role,
  });
  const key = generateSigningKey(prefix);

  const id = uniqid("key_");

  const doc = await ApiKeyModel.create({
    environment,
    project,
    organization,
    description,
    key,
    secret,
    id,
    encryptSDK,
    userId,
    role,
    encryptionKey: encryptSDK ? await generateEncryptionKey() : null,
    dateCreated: new Date(),
  });

  return toInterface(doc);
}

const prefixForApiKey = ({
  environment,
  secret,
  userId,
  role,
}: {
  environment: string;
  secret: boolean;
  userId?: string;
  role?: string;
}): string => {
  // Non-secret keys are SDK keys and use the environment prefix
  if (!secret) {
    return `${getShortEnvName(environment)}_`;
  }

  // Secret keys either have the user or role prefix
  let prefix = "secret_";
  if (userId) {
    prefix += "user_";
  } else if (role) {
    prefix += `${role}_`;
  }

  return prefix;
};

export async function deleteApiKeyById(organization: string, id: string) {
  await ApiKeyModel.deleteOne({
    organization,
    id,
  });
}

export async function deleteApiKeyByKey(organization: string, key: string) {
  await ApiKeyModel.deleteOne({
    organization,
    key,
  });
}

export async function getApiKeyByIdOrKey(
  context: ReqContext | ApiReqContext,
  id: string | undefined,
  key: string | undefined,
): Promise<ApiKeyInterface | null> {
  if (!id && !key) return null;

  const { org } = context;

  const doc = await ApiKeyModel.findOne(
    id ? { organization: org.id, id } : { organization: org.id, key },
  );

  if (!doc) return null;

  const apiKey = toInterface(doc);

  return context.permissions.canReadSingleProjectResource(apiKey.project)
    ? apiKey
    : null;
}

export async function getVisualEditorApiKey(
  organization: string,
  userId: string,
): Promise<ApiKeyInterface | null> {
  const doc = await ApiKeyModel.findOne({
    organization,
    userId,
    role: "visualEditor",
  });
  return doc ? toInterface(doc) : null;
}

export async function lookupOrganizationByApiKey(
  key: string,
): Promise<Partial<ApiKeyInterface>> {
  // If self-hosting on a single org and using a hardcoded secret key
  if (!IS_MULTI_ORG && SECRET_API_KEY && key === SECRET_API_KEY) {
    const { organizations: orgs } = await findAllOrganizations(1, "");
    if (orgs.length === 1) {
      return {
        id: "SECRET_API_KEY",
        key: SECRET_API_KEY,
        secret: true,
        organization: orgs[0].id,
        role: SECRET_API_KEY_ROLE,
      };
    }
  }

  const doc = await getCollection(COLLECTION).findOne({
    key,
  });

  if (!doc || !doc.organization) return {};
  return toInterface(doc);
}

export async function getAllApiKeysByOrganization(
  context: ReqContext,
): Promise<ApiKeyInterface[]> {
  const { org } = context;

  const docs = await getCollection(COLLECTION)
    .find({
      organization: org.id,
    })
    .project({ encryptionKey: 0 })
    .toArray();
  const keys = docs.map((k) => {
    const json = toInterface(k);
    if (json.secret) {
      json.key = "";
    }
    return json;
  });

  return keys.filter((k) => {
    return (
      context.permissions.canReadSingleProjectResource(k.project) ||
      k.userId === context.userId
    );
  });
}

export async function getUnredactedSecretKey(
  organization: string,
  id: string,
): Promise<SecretApiKey | null> {
  const doc = await getCollection(COLLECTION).findOne({
    organization,
    id,
  });
  if (!doc) return null;
  return toInterface(doc) as SecretApiKey;
}
