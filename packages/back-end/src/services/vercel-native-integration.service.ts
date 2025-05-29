import { Promise as BluebirdPromise } from "bluebird";
import { OrganizationInterface } from "back-end/types/organization";
import { FeatureInterface } from "back-end/types/feature";
import { ExperimentInterface } from "back-end/types/experiment";
import {
  VercelIntallationNotFound,
  findVercelInstallationByOrganization,
} from "back-end/src/models/VercelNativeIntegrationModel";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import { getUserByEmail } from "back-end/src/models/UserModel";
import {
  createSdkWebhook,
  findAllSdkWebhooksByConnection,
  findAllSdkWebhooksByPayloadFormat,
  deleteSdkWebhookById,
} from "back-end/src/models/WebhookModel";
import { ReqContextClass } from "back-end/src/services/context";
import { findSDKConnectionsById } from "back-end/src/models/SdkConnectionModel";
import { findOrganizationById } from "back-end/src/models/OrganizationModel";

export const VERCEL_URL = "https://api.vercel.com";

export const VERCEL_CLIENT_ID = process.env.VERCEL_CLIENT_ID || "";
export const VERCEL_CLIENT_SECRET = process.env.VERCEL_CLIENT_SECRET || "";

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
    throw new Error("Invalid response!");

  return data.id_token;
};

const getVercelInstallationData = async (
  organizationId: string,
  projectId: string
) => {
  const {
    installationId,
    resources,
    upsertData: {
      payload: {
        credentials: { access_token: accessToken },
      },
    },
  } = await findVercelInstallationByOrganization(organizationId);

  const resource = resources.find((r) => r.projectId === projectId);

  if (!resource) throw new Error("Invalid installation!");

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
  projectId,
}: {
  experimentationItem: VercelExperimentationItem;
  organization: OrganizationInterface;
  projectId: string;
}) => {
  try {
    const {
      installationId,
      resourceId,
      accessToken,
    } = await getVercelInstallationData(organization.id, projectId);

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
    if (!(err instanceof VercelIntallationNotFound))
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
  feature.project
    ? createVercelExperimentationItem({
        experimentationItem: vercelFeatureExperimentationItem(feature),
        organization,
        projectId: feature.project,
      })
    : undefined;

export const createVercelExperimentationItemFromExperiment = ({
  experiment,
  organization,
}: {
  experiment: ExperimentInterface;
  organization: OrganizationInterface;
}) =>
  experiment.project
    ? createVercelExperimentationItem({
        experimentationItem: vercelExperimentExperimentationItem(experiment),
        organization,
        projectId: experiment.project,
      })
    : undefined;

const updateVercelExperimentationItem = async ({
  experimentationItem,
  organization,
  projectId,
}: {
  experimentationItem: VercelExperimentationItem;
  organization: OrganizationInterface;
  projectId: string;
}) => {
  try {
    const {
      installationId,
      resourceId,
      accessToken,
    } = await getVercelInstallationData(organization.id, projectId);

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
    if (!(err instanceof VercelIntallationNotFound))
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
  feature.project
    ? updateVercelExperimentationItem({
        experimentationItem: vercelFeatureExperimentationItem(feature),
        organization,
        projectId: feature.project,
      })
    : undefined;

export const updateVercelExperimentationItemFromExperiment = ({
  experiment,
  organization,
}: {
  experiment: ExperimentInterface;
  organization: OrganizationInterface;
}) =>
  experiment.project
    ? updateVercelExperimentationItem({
        experimentationItem: vercelExperimentExperimentationItem(experiment),
        organization,
        projectId: experiment.project,
      })
    : undefined;

const deleteVercelExperimentationItem = async ({
  experimentationItem,
  organization,
  projectId,
}: {
  experimentationItem: VercelExperimentationItem;
  organization: OrganizationInterface;
  projectId: string;
}) => {
  try {
    const {
      installationId,
      resourceId,
      accessToken,
    } = await getVercelInstallationData(organization.id, projectId);

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
  } catch (err) {
    if (!(err instanceof VercelIntallationNotFound))
      logger.error(`Error while deleting vercel experimentation item: ${err}`);
  }
};

export const deleteVercelExperimentationItemFromFeature = ({
  feature,
  organization,
}: {
  feature: FeatureInterface;
  organization: OrganizationInterface;
}) =>
  feature.project
    ? deleteVercelExperimentationItem({
        experimentationItem: vercelFeatureExperimentationItem(feature),
        organization,
        projectId: feature.project,
      })
    : undefined;

export const deleteVercelExperimentationItemFromExperiment = ({
  experiment,
  organization,
}: {
  experiment: ExperimentInterface;
  organization: OrganizationInterface;
}) =>
  experiment.project
    ? deleteVercelExperimentationItem({
        experimentationItem: vercelExperimentExperimentationItem(experiment),
        organization,
        projectId: experiment.project,
      })
    : undefined;

export const deleteVercelSdkWebhook = async (context: ReqContextClass) => {
  const webhooks = await findAllSdkWebhooksByPayloadFormat(
    context,
    "vercelNativeIntegration"
  );

  await BluebirdPromise.each(webhooks, (webhook) =>
    deleteSdkWebhookById(context, webhook.id)
  );
};

export const syncVercelSdkConnection = async (organization: string) => {
  const org = await findOrganizationById(organization);

  if (!org) throw new Error("Internal error: no org found");

  if (!org.isVercelIntegration) return;

  const nativeIntegration = await findVercelInstallationByOrganization(org.id);

  const user = await getUserByEmail(
    nativeIntegration.upsertData.authentication.user_email
  );

  if (!user) throw new Error("Internal error: no user found");

  const context = new ReqContextClass({
    org,
    auditUser: null,
    user,
  });

  await BluebirdPromise.each(nativeIntegration.resources, async (resource) => {
    const sdkConnection = await findSDKConnectionsById(
      context,
      resource.sdkConnectionId
    );

    if (!sdkConnection)
      throw new Error("Internal error: no sdk connection found");

    const webhooks = await findAllSdkWebhooksByConnection(
      context,
      sdkConnection.id
    );

    const webhook = webhooks.find(
      (w) =>
        w.managedBy?.type === "vercel" &&
        w.managedBy?.resourceId === resource.id
    );

    if (!resource.protocolSettings?.experimentation?.edgeConfigId) {
      if (webhook) await deleteSdkWebhookById(context, webhook.id);
    } else {
      if (!webhook)
        await createSdkWebhook(context, sdkConnection.id, {
          name: "Sync vercel integration edge config",
          endpoint: `${VERCEL_URL}/v1/installations/${nativeIntegration.installationId}/resources/${resource.id}/experimentation/edge-config`,
          payloadFormat: "vercelNativeIntegration",
          payloadKey: sdkConnection.key,
          httpMethod: "PUT",
          managedBy: {
            type: "vercel",
            resourceId: resource.id,
          },
          headers: JSON.stringify({
            Authorization: `Bearer ${nativeIntegration.upsertData.payload.credentials.access_token}`,
          }),
        });
    }
  });
};
