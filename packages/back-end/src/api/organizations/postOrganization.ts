import { postOrganizationValidator } from "@/src/validators/openapi";
import { PostOrganizationResponse } from "@/types/openapi";
import {
  createOrganization,
  toOrganizationApiInterface,
} from "@/src/models/OrganizationModel";
import {
  createApiRequestHandler,
  validateIsSuperUserRequest,
} from "@/src/util/handler";

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
