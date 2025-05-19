import { OrganizationInterface } from "back-end/types/organization";
import { FeatureInterface } from "back-end/types/feature";
import { ExperimentInterface } from "back-end/types/experiment";
import { findVercelInstallationByOrganization } from "back-end/src/models/VercelNativeIntegrationModel";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import { getUserByEmail } from "back-end/src/models/UserModel";
import {
  createSdkWebhook,
  updateSdkWebhook,
  findSdkWebhook,
  deleteSdkWebhookById,
} from "back-end/src/models/WebhookModel";
import { ReqContextClass } from "back-end/src/services/context";
import { findSDKConnectionsByOrganization } from "back-end/src/models/SdkConnectionModel";
import { findOrganizationById } from "back-end/src/models/OrganizationModel";

export const VERCEL_URL = "https://api.vercel.com";

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

export const getVercelSSOToken = async ({
  code,
  state,
}: {
  code: string;
  state: string;
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
    resources,
    upsertData: {
      payload: {
        credentials: { access_token: accessToken },
      },
    },
  } = await findVercelInstallationByOrganization(organizationId);

  const resource = resources.find((r) => r.organizationId === organizationId);

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
  origin: `${APP_ORIGIN}/features/${id}`,
  category: "flag",
  isArchived,
  description,
  createdAt: dateCreated.getTime(),
  updatedAt: dateUpdated.getTime(),
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
  origin: `${APP_ORIGIN}/experiment/${id}`,
  category: "experiment",
  isArchived,
  description,
  createdAt: dateCreated.getTime(),
  updatedAt: dateUpdated.getTime(),
});

const createVercelExperimentationItem = async ({
  experimentationItem,
  organization,
}: {
  experimentationItem: VercelExperimentationItem;
  organization: OrganizationInterface;
}) => {
  try {
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
  } catch (err) {
    logger.error(`Error while creating vercel experimentation item: ${err}`);
  }
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
  try {
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
  } catch (err) {
    logger.error("Error while creating vercel experimentation item:", err);
  }
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

export const syncVercelSdkWebhook = async (organization: string) => {
  const org = await findOrganizationById(organization);

  if (!org) throw "Internal error";

  if (!org.isVercelIntegration) return;

  const nativeIntegration = await findVercelInstallationByOrganization(org.id);

  if (!nativeIntegration)
    throw new Error(`Could not find a vercel installation for org ${org.id}`);

  const user = await getUserByEmail(
    nativeIntegration.upsertData.authentication.user_email
  );

  if (!user) throw "Internal error";

  const resource = nativeIntegration.resources.find(
    (r) => (r.organizationId = org.id)
  );

  if (!resource) throw "Internal error";

  const context = new ReqContextClass({
    org,
    auditUser: null,
    user,
  });

  const sdkConnections = await findSDKConnectionsByOrganization(context);

  const endpoint = `${VERCEL_URL}/v1/installations/${nativeIntegration.installationId}/resources/${resource.id}/experimentation/edge-config`;
  const webhook = await findSdkWebhook(context, { endpoint });

  if (
    !resource.protocolSettings?.experimentation?.edgeConfigId ||
    !sdkConnections.length
  ) {
    if (!webhook) return;

    await deleteSdkWebhookById(context, webhook.id);

    return;
  }

  const sdks = sdkConnections.map(({ id }) => id);

  const webhookParams = {
    name: "Sync vercel integration edge config",
    endpoint,
    payloadFormat: "vercelNativeIntegration",
    payloadKey: "gb_payload",
    httpMethod: "PUT",
    headers: JSON.stringify({
      Authorization: `Bearer ${nativeIntegration.upsertData.payload.credentials.access_token}`,
    }),
  } as const;

  if (webhook) {
    await updateSdkWebhook(context, webhook, { ...webhookParams, sdks });
    return;
  }

  await createSdkWebhook(context, sdks, webhookParams);
};
