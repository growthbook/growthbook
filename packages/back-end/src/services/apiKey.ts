import uniqid from "uniqid";
import { ApiKeyModel } from "../models/ApiKeyModel";
import md5 from "md5";

export async function createApiKey(
  organization: string,
  environment: string,
  description?: string
): Promise<string> {
  const key =
    "key_" + environment.substr(0, 4) + "_" + md5(uniqid()).substr(0, 16);

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
