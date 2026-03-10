import { PostOrganizationResponse } from "shared/types/openapi";
import { postOrganizationValidator } from "shared/validators";
import {
  createApiRequestHandler,
  validateIsSuperUserRequest,
} from "back-end/src/util/handler";
import {
  createOrganization,
  toOrganizationApiInterface,
} from "back-end/src/models/OrganizationModel";

export const postOrganization = createApiRequestHandler(
  postOrganizationValidator,
)(async (req): Promise<PostOrganizationResponse> => {
  const user = await validateIsSuperUserRequest(req);

  const { name, externalId } = req.body;

  if (name.length < 3) {
    throw Error("Name length must be at least 3 characters");
  }
  if (name.length > 60) {
    throw Error("Name length must be at most 60 characters");
  }

  const org = await createOrganization({
    email: user.email,
    userId: user.id,
    externalId,
    name,
  });

  return {
    organization: toOrganizationApiInterface(org),
  };
});
