import { PostOrganizationResponse } from "shared/types/openapi";
import { putOrganizationValidator } from "shared/validators";
import {
  createApiRequestHandler,
  validateIsSuperUserRequest,
} from "back-end/src/util/handler";
import {
  findOrganizationById,
  toOrganizationApiInterface,
  updateOrganization,
} from "back-end/src/models/OrganizationModel";
import { OrganizationInterface } from "back-end/types/organization";

export const putOrganization = createApiRequestHandler(
  putOrganizationValidator,
)(async (req): Promise<PostOrganizationResponse> => {
  await validateIsSuperUserRequest(req);

  const id = req.params.id;
  const { name, externalId } = req.body;

  const org = await findOrganizationById(id);
  if (!org) {
    throw Error("Organization not found");
  }

  const updates: Partial<OrganizationInterface> = {};
  if (name) {
    if (name.length < 3) {
      throw Error("Name length must be at least 3 characters");
    }
    updates.name = name;
  }
  if (externalId) {
    updates.externalId = externalId;
  }

  await updateOrganization(id, updates);

  return {
    organization: toOrganizationApiInterface({
      ...org,
      ...updates,
    }),
  };
});
