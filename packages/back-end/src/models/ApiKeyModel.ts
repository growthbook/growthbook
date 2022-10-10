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

async function createKey<T>(
  data: Omit<ApiKeyInterface, "id" | "dateCreated">
): Promise<T> {
  const id = uniqid("key_");

  const doc = await ApiKeyModel.create({
    ...data,
    id,
    dateCreated: new Date(),
  });

  return doc.toJSON() as T;
}

export async function createPublishableApiKey({
  environment,
  organization,
  description,
}: {
  environment: string;
  organization: string;
  description: string;
}): Promise<PublishableApiKey> {
  const key =
    "pk_" +
    environment.substring(0, 4) +
    "_" +
    crypto.randomBytes(32).toString("base64").replace(/[=/+]/g, "");

  return createKey<PublishableApiKey>({
    environment,
    organization,
    description,
    key,
    secret: false,
  });
}

export async function createSecretApiKey({
  organization,
  description,
}: {
  organization: string;
  description: string;
}): Promise<SecretApiKey> {
  const key =
    "sk_" + crypto.randomBytes(32).toString("base64").replace(/[=/+]/g, "");

  return createKey<SecretApiKey>({
    organization,
    description,
    key,
    secret: true,
  });
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

export async function lookupOrganizationByApiKey(
  key: string
): Promise<{ organization?: string; key?: ApiKeyInterface }> {
  const doc = await ApiKeyModel.findOne({
    key,
  });

  if (!doc || !doc.organization) return {};
  return { organization: doc.organization, key: doc.toJSON() };
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
