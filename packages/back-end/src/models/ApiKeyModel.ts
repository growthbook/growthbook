import mongoose from "mongoose";
import {
  ApiKeyInterface,
  PublishableApiKey,
  SecretApiKey,
} from "../../types/apikey";
import uniqid from "uniqid";
import { privateKeyToString, publicKeyToString } from "../util/encryptedSDK";
import crypto from "crypto";
// eslint-disable-next-line
const { subtle } = require("crypto").webcrypto;

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
  encryptSDK: Boolean,
  encryptionPublicKey: String,
  encryptionPrivateKey: String,
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
  encryptSDK,
}: {
  environment: string;
  organization: string;
  description: string;
  secret: boolean;
  encryptSDK: boolean;
}): Promise<ApiKeyInterface> {
  if (!secret && !environment) {
    throw new Error("SDK Endpoints must have an environment set");
  }

  const keyPair: null | CryptoKeyPair = encryptSDK
    ? await subtle.generateKey(
        {
          name: "RSA-OAEP",
          modulusLength: 4096,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["encrypt", "decrypt"]
      )
    : null;

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
    encryptSDK,
    encryptionPrivateKey:
      encryptSDK && keyPair
        ? await privateKeyToString(keyPair.privateKey)
        : null,
    encryptionPublicKey:
      encryptSDK && keyPair ? await publicKeyToString(keyPair.publicKey) : null,
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
  const docs = await ApiKeyModel.find(
    {
      organization,
    },
    { encryptionPublicKey: 0, encryptionPrivateKey: 0 }
  );
  return docs.map((k) => {
    const json = k.toJSON();
    if (json.secret) {
      json.key = "";
    }
    return json;
  });
}

export async function getEncryptedSDKByKey(
  organization: string,
  key: string
): Promise<{ encryptionPrivateKey?: string } | null> {
  return ApiKeyModel.findOne(
    { organization, key },
    { encryptionPrivateKey: 1 }
  );
}

export async function getFirstPublishableApiKey(
  organization: string,
  environment: string
): Promise<null | PublishableApiKey> {
  const doc = await ApiKeyModel.findOne(
    {
      organization,
      environment,
      secret: {
        $ne: true,
      },
    },
    { encryptionPublicKey: 0, encryptionPrivateKey: 0 }
  );

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
