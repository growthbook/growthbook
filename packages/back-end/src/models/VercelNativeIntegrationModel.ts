import { z } from "zod";
import mongoose from "mongoose";
import {
  upsertInstallationPayloadValidator,
  userAuthenticationValidator,
  resourceValidator,
} from "back-end/src/routers/vercel-native-integration/vercel-native-integration.validators";
import { MakeModelClass } from "./BaseModel";

const upsertDataValidator = z
  .object({
    payload: upsertInstallationPayloadValidator,
    authentication: userAuthenticationValidator.shape.payload.strict(),
  })
  .strict();

const installationResourceValidator = resourceValidator.extend({
  projectId: z.string(),
  sdkConnectionId: z.string(),
});

export type Resource = z.infer<typeof installationResourceValidator>;

const vercelNativeIntegrationValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    installationId: z.string(),
    billingPlanId: z.string().optional(),
    resources: z.array(installationResourceValidator),
    upsertData: upsertDataValidator,
  })
  .strict();

export type VercelNativeIntegration = z.infer<
  typeof vercelNativeIntegrationValidator
>;

const COLLECTION_NAME = "vercelNativeIntegration";

const BaseClass = MakeModelClass({
  schema: vercelNativeIntegrationValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "vclni_",
  auditLog: {
    entity: "vercelNativeIntegration",
    createEvent: "vercelNativeIntegration.create",
    updateEvent: "vercelNativeIntegration.update",
    deleteEvent: "vercelNativeIntegration.delete",
  },
  globallyUniqueIds: true,
  additionalIndexes: [{ fields: { installationId: 1 }, unique: true }],
});

export class VercelNativeIntegrationModel extends BaseClass {
  protected canRead(): boolean {
    return true;
  }

  protected canCreate(): boolean {
    return this.context.permissions.canManageIntegrations();
  }

  protected canUpdate(): boolean {
    return this.context.permissions.canManageIntegrations();
  }

  protected canDelete(): boolean {
    return this.context.permissions.canManageIntegrations();
  }
}

export const findVercelInstallationByInstallationId = async (
  installationId: string,
): Promise<VercelNativeIntegration> => {
  const model = await mongoose.connection.db
    .collection(COLLECTION_NAME)
    .findOne({ installationId });

  if (!model) throw "Installation not found!";

  return model as unknown as VercelNativeIntegration;
};

export class VercelIntallationNotFound extends Error {}

export const findVercelInstallationByOrganization = async (
  organization: string,
): Promise<VercelNativeIntegration> => {
  const model = await mongoose.connection.db
    .collection(COLLECTION_NAME)
    .findOne({ organization: { $eq: organization } });

  if (!model)
    throw new VercelIntallationNotFound(
      `Vercel installation not found for org ${organization}!`,
    );

  return model as unknown as VercelNativeIntegration;
};
