import { ApiKeyModel } from "../models/ApiKeyModel";
import crypto from "crypto";

export async function createApiKey(
  organization: string,
  environment: string,
  description?: string
): Promise<string> {
  const keyBase = `key_${environment.substring(0, 4)}_`;
  let keySecret = "";
  while (keySecret.length < 32) {
    keySecret = crypto
      .randomBytes(128)
      .toString("base64")
      .replace(/[=+/]/g, "")
      .substring(0, 32);
  }
  const key = keyBase + keySecret;

  await ApiKeyModel.create({
    organization,
    key,
    description,
    environment,
    dateCreated: new Date(),
  });

  return key;
}

export async function deleteByOrganizationAndApiKey(
  organization: string,
  key: string
) {
  await ApiKeyModel.deleteOne({
    organization,
    key,
  });
  return;
}

export async function lookupOrganizationByApiKey(
  key: string
): Promise<{ organization?: string; environment?: string }> {
  const doc = await ApiKeyModel.findOne({
    key,
  });

  if (!doc || !doc.organization) return {};
  const { organization, environment } = doc;
  return { organization, environment };
}

export async function getAllApiKeysByOrganization(organization: string) {
  return ApiKeyModel.find({
    organization,
  });
}

export async function getFirstApiKey(
  organization: string,
  environment: string
) {
  return ApiKeyModel.findOne({
    organization,
    environment,
  });
}
