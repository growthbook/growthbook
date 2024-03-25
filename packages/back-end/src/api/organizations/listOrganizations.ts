import { listOrganizationsValidator } from "@back-end/src/validators/openapi";
import { ListOrganizationsResponse } from "@back-end/types/openapi";
import {
  findAllOrganizations,
  toOrganizationApiInterface,
} from "@back-end/src/models/OrganizationModel";
import {
  createApiRequestHandler,
  getPaginationReturnFields,
  validateIsSuperUserRequest,
} from "@back-end/src/util/handler";

export const listOrganizations = createApiRequestHandler(
  listOrganizationsValidator
)(
  async (req): Promise<ListOrganizationsResponse> => {
    await validateIsSuperUserRequest(req);

    const organizations = await findAllOrganizations(
      1 + req.query.offset / req.query.limit,
      req.query.search || "",
      req.query.limit
    );

    return {
      organizations: organizations.organizations.map((organization) =>
        toOrganizationApiInterface(organization)
      ),
      ...getPaginationReturnFields(
        organizations.organizations,
        organizations.total,
        req.query
      ),
    };
  }
);
