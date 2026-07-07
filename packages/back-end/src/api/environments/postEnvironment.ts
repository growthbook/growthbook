import { postEnvironmentValidator } from "shared/validators";
import { OrganizationInterface } from "shared/types/organization";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { assertEnvironmentCreateAllowed } from "back-end/src/services/plan-limits";
import { validatePayload } from "./validations";

export const postEnvironment = createApiRequestHandler(
  postEnvironmentValidator,
)(async (req) => {
  const environment = await validatePayload(req.context, req.body);

  const org = req.context.org;

  if (org.settings?.environments?.some((env) => env.id === environment.id)) {
    throw Error(`Environment ${environment.id} already exists!`);
  }

  if (!req.context.permissions.canCreateEnvironment(environment)) {
    req.context.permissions.throwPermissionError();
  }

  // Pricing Phase 1: soft limit — block creating non-default environments
  // when the plan's policy is default-only.
  assertEnvironmentCreateAllowed(org, environment.id);

  const updates: Partial<OrganizationInterface> = {
    settings: {
      ...org.settings,
      environments: [...(org.settings?.environments || []), environment],
    },
  };

  await updateOrganization(org.id, updates);

  await req.audit({
    event: "environment.create",
    entity: {
      object: "environment",
      id: environment.id,
    },
    details: auditDetailsCreate(environment),
  });

  return {
    environment,
  };
});
