import { listOrganizationsValidator } from "shared/validators";
import {
  findAllOrganizations,
  toOrganizationApiInterface,
} from "back-end/src/models/OrganizationModel";
import {
  createApiRequestHandler,
  getPaginationReturnFields,
  validateIsSuperUserRequest,
} from "back-end/src/util/handler";

export const listOrganizations = createApiRequestHandler(
  listOrganizationsValidator,
)(async (req) => {
  await validateIsSuperUserRequest(req);

  const limit = req.query.limit ?? 10;
  const offset = req.query.offset ?? 0;

  const organizations = await findAllOrganizations(
    1 + offset / limit,
    req.query.search || "",
    limit,
  );

  return {
    organizations: organizations.organizations.map((organization) =>
      toOrganizationApiInterface(organization),
    ),
    ...getPaginationReturnFields(
      organizations.organizations,
      organizations.total,
      { limit, offset },
    ),
  };
});
