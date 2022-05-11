import uniqid from "uniqid";
import { ApiKeyModel } from "../models/ApiKeyModel";
import md5 from "md5";

export async function createApiKey(
  organization: string,
  environment: string,
  description?: string,
  includeDrafts?: boolean
): Promise<string> {
  const key =
    "key_" + environment.substr(0, 4) + "_" + md5(uniqid()).substr(0, 16);

  await ApiKeyModel.create({
    organization,
    key,
    description,
    environment,
    includeDrafts,
    dateCreated: new Date(),
  });

  return key;
}

export async function updateApiKey(
  organization: string,
  key: string,
  description?: string,
  includeDrafts?: boolean
) {
  await ApiKeyModel.updateOne(
    {
      organization,
      key,
    },
    {
      $set: {
        description,
        includeDrafts,
      },
    }
  );
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
): Promise<{
  organization?: string;
  environment?: string;
  includeDrafts?: boolean;
}> {
  const doc = await ApiKeyModel.findOne({
    key,
  });

  if (!doc || !doc.organization) return {};
  const { organization, environment, includeDrafts } = doc;
  return { organization, environment, includeDrafts };
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
