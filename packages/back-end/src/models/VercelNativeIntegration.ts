import { z } from "zod";
import mongoose from "mongoose";
import {
  upsertInstallationPayloadValidator,
  userAuthenticationValidator,
  resourceValidator,
} from "back-end/src/routers/vercel-native-integration/vercel-native-integration.validators";
import { MakeModelClass } from "./BaseModel";

const vercelNativeIntegrationValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    installationId: z.string(),
    // This is NOT an installation-level billingPlanId
    billingPlanId: z.string().optional(),
    resource: resourceValidator.optional(),
    upsertData: z
      .object({
        payload: upsertInstallationPayloadValidator,
        authentication: userAuthenticationValidator.shape.payload.strict(),
      })
      .strict(),
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

  public getByInstallationId(data: {
    organization: string;
    installationId: string;
  }) {
    return this._findOne(data);
  }
}

export const findVercelInstallationDataByResourceId = async (
  resourceId: string
): Promise<{ organizationId: string; id: string; installationId: string }> => {
  const model = await mongoose.connection.db
    .collection(COLLECTION_NAME)
    .findOne({ "resource.id": resourceId });

  if (!model) throw "Installation not found!";

  return {
    organizationId: model.organization,
    id: model.id,
    installationId: model.installationId,
  };
};

export const findVercelInstallationDataByInstallationId = async (
  installationId: string
): Promise<{ organizationId: string; id: string; installationId: string }> => {
  const model = await mongoose.connection.db
    .collection(COLLECTION_NAME)
    .findOne({ installationId: installationId });

  if (!model) throw "Installation not found!";

  return {
    organizationId: model.organization,
    id: model.id,
    installationId: model.installationId,
  };
};
