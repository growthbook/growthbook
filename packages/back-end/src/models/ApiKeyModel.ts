import mongoose from "mongoose";
import {
  ApiKeyInterface,
  PublishableApiKey,
  SecretApiKey,
} from "../../types/apikey";
import uniqid from "uniqid";
import crypto from "crypto";

const apiKeySchema = new mongoose.Schema({
  id: String,
  key: {
    type: String,
    unique: true,
  },
  environment: String,
  description: String,
  organization: String,
  dateCreated: Date,
  secret: Boolean,
});

type ApiKeyDocument = mongoose.Document & ApiKeyInterface;

const ApiKeyModel = mongoose.model<ApiKeyDocument>("ApiKey", apiKeySchema);

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

export async function createApiKey({
  environment,
  organization,
  description,
  secret,
}: {
  environment: string;
  organization: string;
  description: string;
  secret: boolean;
}): Promise<ApiKeyInterface> {
  if (!secret && !environment) {
    throw new Error("SDK Endpoints must have an environment set");
  }

  const prefix = secret ? "secret_" : `${getShortEnvName(environment)}_`;
  const key =
    prefix + crypto.randomBytes(32).toString("base64").replace(/[=/+]/g, "");

  const id = uniqid("key_");

  const doc = await ApiKeyModel.create({
    environment,
    organization,
    description,
    key,
    secret,
    id,
    dateCreated: new Date(),
  });

  return doc.toJSON();
}

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
  organization: string,
  id: string | undefined,
  key: string | undefined
): Promise<ApiKeyInterface | null> {
  const doc = await ApiKeyModel.findOne({
    organization,
    id,
    key,
  });
  return doc ? doc.toJSON() : null;
}

export async function lookupOrganizationByApiKey(
  key: string
): Promise<Partial<ApiKeyInterface>> {
  const doc = await ApiKeyModel.findOne({
    key,
  });

  if (!doc || !doc.organization) return {};
  return doc.toJSON();
}

export async function getAllApiKeysByOrganization(
  organization: string
): Promise<ApiKeyInterface[]> {
  const docs = await ApiKeyModel.find({
    organization,
  });
  return docs.map((k) => {
    const json = k.toJSON();
    if (json.secret) {
      json.key = "";
    }
    return json;
  });
}

export async function getFirstPublishableApiKey(
  organization: string,
  environment: string
): Promise<null | PublishableApiKey> {
  const doc = await ApiKeyModel.findOne({
    organization,
    environment,
    secret: {
      $ne: true,
    },
  });

  if (!doc) return null;

  return doc.toJSON() as PublishableApiKey;
}

export async function getUnredactedSecretKey(
  organization: string,
  id: string
): Promise<SecretApiKey | null> {
  const doc = await ApiKeyModel.findOne({
    organization,
    id,
  });
  if (!doc) return null;
  return doc.toJSON() as SecretApiKey;
}
