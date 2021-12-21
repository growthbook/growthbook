import uniqid from "uniqid";
import { ApiKeyModel } from "../models/ApiKeyModel";
import md5 from "md5";

export async function createApiKey(
  organization: string,
  description?: string
): Promise<string> {
  const key = "key_" + md5(uniqid()).substr(0, 16);

  await ApiKeyModel.create({
    organization,
    key,
    description,
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
): Promise<string | null> {
  const doc = await ApiKeyModel.findOne({
    key,
  });

  if (!doc) return null;
  return doc.organization || null;
}

export async function getAllApiKeysByOrganization(organization: string) {
  return ApiKeyModel.find({
    organization,
  });
}

export async function getFirstApiKey(organization: string) {
  return ApiKeyModel.findOne({
    organization,
  });
}
