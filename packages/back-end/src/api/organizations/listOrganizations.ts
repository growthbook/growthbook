import { ListOrganizationsResponse } from "../../../types/openapi";
import {
  findAllOrganizations,
  toOrganizationApiInterface,
} from "../../models/OrganizationModel";
import {
  createApiRequestHandler,
  getPaginationReturnFields,
  validateIsSuperUserRequest,
} from "../../util/handler";
import { listOrganizationsValidator } from "../../validators/openapi";

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
