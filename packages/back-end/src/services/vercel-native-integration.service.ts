import { OrganizationInterface } from "back-end/types/organization";
import { FeatureInterface } from "back-end/types/feature";
import { ExperimentInterface } from "back-end/types/experiment";
import { findVercelInstallationByOrganization } from "back-end/src/models/VercelNativeIntegration";

const VERCEL_URL = "https://api.vercel.com";

const VERCEL_CLIENT_ID = process.env.VERCEL_CLIENT_ID || "";
const VERCEL_CLIENT_SECRET = process.env.VERCEL_CLIENT_SECRET || "";

export type VercelExperimentationItem = {
  id: string;
  slug: string;
  origin: string;
  category: "flag" | "experiment";
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

const vercelFeatureExperimentationItem = ({
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
  category: "flag",
  isArchived,
  description,
  createdAt: Math.floor(dateCreated.getTime() / 1000),
  updatedAt: Math.floor(dateUpdated.getTime() / 1000),
});

const vercelExperimentExperimentationItem = ({
  id,
  archived: isArchived,
  trackingKey: slug,
  description,
  dateCreated,
  dateUpdated,
}: ExperimentInterface): VercelExperimentationItem => ({
  id,
  slug,
  origin: FEATURE_ORIGIN,
  category: "experiment",
  isArchived,
  description,
  createdAt: Math.floor(dateCreated.getTime() / 1000),
  updatedAt: Math.floor(dateUpdated.getTime() / 1000),
});

const createVercelExperimentationItem = async ({
  experimentationItem,
  organization,
}: {
  experimentationItem: VercelExperimentationItem;
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
      body: JSON.stringify({
        items: [experimentationItem],
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!ret.ok)
    throw new Error(`Error creating vercel resource: ${await ret.text()}`);
};

export const createVercelExperimentationItemFromFeature = ({
  feature,
  organization,
}: {
  feature: FeatureInterface;
  organization: OrganizationInterface;
}) =>
  createVercelExperimentationItem({
    experimentationItem: vercelFeatureExperimentationItem(feature),
    organization,
  });

export const createVercelExperimentationItemFromExperiment = ({
  experiment,
  organization,
}: {
  experiment: ExperimentInterface;
  organization: OrganizationInterface;
}) =>
  createVercelExperimentationItem({
    experimentationItem: vercelExperimentExperimentationItem(experiment),
    organization,
  });

const updateVercelExperimentationItem = async ({
  experimentationItem,
  organization,
}: {
  experimentationItem: VercelExperimentationItem;
  organization: OrganizationInterface;
}) => {
  const {
    installationId,
    resourceId,
    accessToken,
  } = await getVercelInstallationData(organization.id);

  const { id: _id, ...updatedItem } = experimentationItem;

  const ret = await fetch(
    `${VERCEL_URL}/v1/installations/${installationId}/resources/${resourceId}/experimentation/items/${experimentationItem.id}`,
    {
      method: "PATCH",
      body: JSON.stringify(updatedItem),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!ret.ok)
    throw new Error(`Error updating vercel resource: ${await ret.text()}`);
};

export const updateVercelExperimentationItemFromFeature = ({
  feature,
  organization,
}: {
  feature: FeatureInterface;
  organization: OrganizationInterface;
}) =>
  updateVercelExperimentationItem({
    experimentationItem: vercelFeatureExperimentationItem(feature),
    organization,
  });

export const updateVercelExperimentationItemFromExperiment = ({
  experiment,
  organization,
}: {
  experiment: ExperimentInterface;
  organization: OrganizationInterface;
}) =>
  updateVercelExperimentationItem({
    experimentationItem: vercelExperimentExperimentationItem(experiment),
    organization,
  });

const deleteVercelExperimentationItem = async ({
  experimentationItem,
  organization,
}: {
  experimentationItem: VercelExperimentationItem;
  organization: OrganizationInterface;
}) => {
  const {
    installationId,
    resourceId,
    accessToken,
  } = await getVercelInstallationData(organization.id);

  const ret = await fetch(
    `${VERCEL_URL}/v1/installations/${installationId}/resources/${resourceId}/experimentation/items/${experimentationItem.id}`,
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

export const deleteVercelExperimentationItemFromFeature = ({
  feature,
  organization,
}: {
  feature: FeatureInterface;
  organization: OrganizationInterface;
}) =>
  deleteVercelExperimentationItem({
    experimentationItem: vercelFeatureExperimentationItem(feature),
    organization,
  });

export const deleteVercelExperimentationItemFromExperiment = ({
  experiment,
  organization,
}: {
  experiment: ExperimentInterface;
  organization: OrganizationInterface;
}) =>
  deleteVercelExperimentationItem({
    experimentationItem: vercelExperimentExperimentationItem(experiment),
    organization,
  });
