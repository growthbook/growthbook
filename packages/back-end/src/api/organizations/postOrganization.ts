import { PostOrganizationResponse } from "../../../types/openapi";
import {
  createApiRequestHandler,
  validateIsSuperUserRequest,
} from "../../util/handler";
import { postOrganizationValidator } from "../../validators/openapi";
import {
  createOrganization,
  toOrganizationApiInterface,
} from "../../models/OrganizationModel";

export const postOrganization = createApiRequestHandler(
  postOrganizationValidator
)(
  async (req): Promise<PostOrganizationResponse> => {
    const user = await validateIsSuperUserRequest(req);

    const { name, externalId } = req.body;

    if (name.length < 3) {
      throw Error("Name length must be at least 3 characters");
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
  }
);
