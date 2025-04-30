import { OrganizationInterface } from "back-end/types/organization";
import { FeatureInterface } from "back-end/types/feature";
import { findVercelInstallationByOrganization } from "back-end/src/models/VercelNativeIntegration";

const VERCEL_URL = "https://api.vercel.com";

const VERCEL_CLIENT_ID = process.env.VERCEL_CLIENT_ID || "";
const VERCEL_CLIENT_SECRET = process.env.VERCEL_CLIENT_SECRET || "";

export type VercelExperimentationItem = {
  id: string;
  slug: string;
  origin: string;
  category?: string;
  name?: string;
  description?: string;
  isArchived?: boolean;
  createdAt?: number;
  updatedAt?: number;
};

const FEATURE_ORIGIN = "app.growthbook.io";

export const getVercelSSOToken = async ({
  code,
  accessToken,
  state,
}: {
  code: string;
  state: string;
  accessToken: string;
}) => {
  const ret = await fetch(`${VERCEL_URL}/v1/integrations/sso/token`, {
    method: "POST",
    body: JSON.stringify({
      code,
      state,
      client_id: VERCEL_CLIENT_ID,
      client_secret: VERCEL_CLIENT_SECRET,
    }),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!ret.ok)
    throw new Error(`Error fetching vercel SSO auth: ${await ret.text()}`);

  const data = await ret.json();

  if (!("id_token" in data) || typeof data.id_token !== "string")
    throw "Invalid response!";

  return data.id_token;
};

const getVercelInstallationData = async (organizationId: string) => {
  const {
    installationId,
    resource,
    upsertData: {
      payload: {
        credentials: { access_token: accessToken },
      },
    },
  } = await findVercelInstallationByOrganization(organizationId);

  if (!resource) throw "Invalid installation!";

  const { id: resourceId } = resource;

  return { installationId, resourceId, accessToken };
};

const vercelExpeimentationItem = ({
  id,
  archived: isArchived,
  id: slug,
  description,
  dateCreated,
  dateUpdated,
}: FeatureInterface): VercelExperimentationItem => ({
  id,
  slug,
  origin: FEATURE_ORIGIN,
  isArchived,
  description,
  createdAt: Math.floor(dateCreated.getTime() / 1000),
  updatedAt: Math.floor(dateUpdated.getTime() / 1000),
});

export const createVercelExperimentationItemFromFeature = async ({
  feature,
  organization,
}: {
  feature: FeatureInterface;
  organization: OrganizationInterface;
}) => {
  const {
    installationId,
    resourceId,
    accessToken,
  } = await getVercelInstallationData(organization.id);

  const ret = await fetch(
    `${VERCEL_URL}/v1/installations/${installationId}/resources/${resourceId}/experimentation/items`,
    {
      method: "POST",
      body: JSON.stringify({ items: [vercelExpeimentationItem(feature)] }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!ret.ok)
    throw new Error(`Error creating vercel resource: ${await ret.text()}`);
};

export const updateVercelExperimentationItemFromFeature = async ({
  feature,
  organization,
}: {
  feature: FeatureInterface;
  organization: OrganizationInterface;
}) => {
  const {
    installationId,
    resourceId,
    accessToken,
  } = await getVercelInstallationData(organization.id);

  const { id: _id, ...updatedFeature } = vercelExpeimentationItem(feature);

  const ret = await fetch(
    `${VERCEL_URL}/v1/installations/${installationId}/resources/${resourceId}/experimentation/items/${feature.id}`,
    {
      method: "PATCH",
      body: JSON.stringify(updatedFeature),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!ret.ok)
    throw new Error(`Error updating vercel resource: ${await ret.text()}`);
};

export const deleteVercelExperimentationItemFromFeature = async ({
  feature,
  organization,
}: {
  feature: FeatureInterface;
  organization: OrganizationInterface;
}) => {
  const {
    installationId,
    resourceId,
    accessToken,
  } = await getVercelInstallationData(organization.id);

  const ret = await fetch(
    `${VERCEL_URL}/v1/installations/${installationId}/resources/${resourceId}/experimentation/items/${feature.id}`,
    {
      method: "DELETE",
      body: JSON.stringify({
        client_id: VERCEL_CLIENT_ID,
        client_secret: VERCEL_CLIENT_SECRET,
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!ret.ok)
    throw new Error(`Error deleting vercel resource: ${await ret.text()}`);
};
