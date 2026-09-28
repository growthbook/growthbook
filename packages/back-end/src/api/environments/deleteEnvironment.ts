import { deleteEnvironmentValidator } from "shared/validators";
import { OrganizationInterface } from "shared/types/organization";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsDelete } from "back-end/src/services/audit";
import {
  assertEnvironmentDeletable,
  cleanupDeletedEnvironment,
} from "back-end/src/services/environments";

export const deleteEnvironment = createApiRequestHandler(
  deleteEnvironmentValidator,
)(async (req) => {
  const id = req.params.id;
  const org = req.context.org;
  const environments = org.settings?.environments || [];

  const environment = environments.find((env) => env.id === id);
  if (!environment) {
    throw Error(`Environment ${id} does not exists!`);
  }

  if (!req.context.permissions.canDeleteEnvironment(environment))
    req.context.permissions.throwPermissionError();

  await assertEnvironmentDeletable(req.context, id);

  const updates: Partial<OrganizationInterface> = {
    settings: {
      ...org.settings,
      environments: [...environments.filter((env) => env.id !== id)],
    },
  };

  await updateOrganization(org.id, updates);
  await cleanupDeletedEnvironment(org.id, id);

  await req.audit({
    event: "environment.delete",
    entity: {
      object: "environment",
      id: environment.id,
    },
    details: auditDetailsDelete(environment),
  });

  return {
    deletedId: id,
  };
});
