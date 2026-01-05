import { Promise as BluebirdPromise } from "bluebird";
import { OrganizationInterface } from "shared/types/organization";
import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterface } from "shared/types/experiment";
import { VercelIntallationNotFound } from "shared/util";
import { findVercelInstallationByOrganization } from "back-end/src/models/VercelNativeIntegrationModel";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import {
  createSdkWebhook,
  findAllSdkWebhooksByConnection,
  findAllSdkWebhooksByPayloadFormat,
  deleteSdkWebhookById,
} from "back-end/src/models/WebhookModel";
import { fireSdkWebhook } from "back-end/src/jobs/sdkWebhooks";
import { ReqContextClass } from "back-end/src/services/context";
import { findSDKConnectionsById } from "back-end/src/models/SdkConnectionModel";
import { findOrganizationById } from "back-end/src/models/OrganizationModel";

export const VERCEL_URL = "https://api.vercel.com";

export const VERCEL_CLIENT_ID = process.env.VERCEL_CLIENT_ID || "";
export const VERCEL_CLIENT_SECRET = process.env.VERCEL_CLIENT_SECRET || "";

const VERCEL_WEBHOOK_TOKEN_SECRET_NAME = (sdkConnectionId: string) =>
  `VERCEL_INTEGRATION_TOKEN_${sdkConnectionId}`;

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
  projectId: string,
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
  id: `features:${id}`,
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
  id: `experiment:${id}`,
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
    const { installationId, resourceId, accessToken } =
      await getVercelInstallationData(organization.id, projectId);

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
      },
    );

    if (!ret.ok)
      throw new Error(`Error creating vercel resource: ${await ret.text()}`);
  } catch (err) {
    if (!(err instanceof VercelIntallationNotFound))
      logger.error(err, `Error while creating vercel experimentation item`);
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
    const { installationId, resourceId, accessToken } =
      await getVercelInstallationData(organization.id, projectId);

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
      },
    );

    if (!ret.ok)
      throw new Error(`Error updating vercel resource: ${await ret.text()}`);
  } catch (err) {
    if (!(err instanceof VercelIntallationNotFound))
      logger.error(err, "Error while creating vercel experimentation item");
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
    const { installationId, resourceId, accessToken } =
      await getVercelInstallationData(organization.id, projectId);

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
      },
    );

    if (!ret.ok)
      throw new Error(`Error deleting vercel resource: ${await ret.text()}`);
  } catch (err) {
    if (!(err instanceof VercelIntallationNotFound))
      logger.error(err, `Error while deleting vercel experimentation item`);
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
    "vercelNativeIntegration",
  );

  await BluebirdPromise.each(webhooks, async (webhook) => {
    await context.models.webhookSecrets.deleteByKey(
      VERCEL_WEBHOOK_TOKEN_SECRET_NAME(webhook.sdks[0]),
    );

    await deleteSdkWebhookById(context, webhook.id);
  });
};

export const syncVercelSdkConnection = async (organization: string) => {
  const org = await findOrganizationById(organization);

  if (!org) throw new Error("Internal error: no org found");

  if (!org.isVercelIntegration) return;

  const nativeIntegration = await findVercelInstallationByOrganization(org.id);

  const context = new ReqContextClass({
    org,
    auditUser: null,
    role: "admin",
  });

  await BluebirdPromise.each(nativeIntegration.resources, async (resource) => {
    const sdkConnection = await findSDKConnectionsById(
      context,
      resource.sdkConnectionId,
    );

    if (!sdkConnection)
      throw new Error("Internal error: no sdk connection found");

    const webhooks = await findAllSdkWebhooksByConnection(
      context,
      sdkConnection.id,
    );

    const webhook = webhooks.find(
      (w) =>
        w.managedBy?.type === "vercel" &&
        w.managedBy?.resourceId === resource.id,
    );

    if (!resource.protocolSettings?.experimentation?.edgeConfigId) {
      if (webhook) {
        await deleteSdkWebhookById(context, webhook.id);
        await context.models.webhookSecrets.deleteByKey(
          VERCEL_WEBHOOK_TOKEN_SECRET_NAME(sdkConnection.id),
        );
      }
    } else {
      if (!webhook) {
        await context.models.webhookSecrets.deleteByKey(
          VERCEL_WEBHOOK_TOKEN_SECRET_NAME(sdkConnection.id),
        );

        const createdWebhook = await createSdkWebhook(
          context,
          sdkConnection.id,
          {
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
              Authorization: `Bearer {{${VERCEL_WEBHOOK_TOKEN_SECRET_NAME(
                sdkConnection.id,
              )}}}`,
            }),
          },
        );

        await context.models.webhookSecrets.create({
          key: VERCEL_WEBHOOK_TOKEN_SECRET_NAME(sdkConnection.id),
          value: nativeIntegration.upsertData.payload.credentials.access_token,
        });

        // Webhook needs to fire after returning so that vercel
        // can be properly setup with the edge config enabled.
        // Otherwise, this may fire before vercel has finished its
        // edge configuration callback.
        setTimeout(async () => {
          try {
            await fireSdkWebhook(context, createdWebhook);
          } catch (err) {
            logger.error(err, "Error while firing webhook");
          }
        }, 1000);
      }
    }
  });
};
