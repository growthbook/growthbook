import { z } from "zod";
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
    billingPlanId: z.string().optional(),
    resources: z.array(resourceValidator).optional(),
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

const BaseClass = MakeModelClass({
  schema: vercelNativeIntegrationValidator,
  collectionName: "vercelNativeIntegration",
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
