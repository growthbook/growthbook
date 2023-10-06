import { freeEmailDomains } from "free-email-domains-typescript";
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

    const { name } = req.body;

    if (name.length < 3) {
      throw Error("Name length must be at least 3 characters");
    }

    let verifiedDomain = "";

    // if the owner is verified, try to infer a verified domain
    if (user.email && user.verified) {
      const domain = user.email.toLowerCase().split("@")[1] || "";
      const isFreeDomain = freeEmailDomains.includes(domain);
      if (!isFreeDomain) {
        verifiedDomain = domain;
      }
    }

    const org = await createOrganization({
      email: user.email,
      userId: user.id,
      name: name,
      verifiedDomain,
    });

    return {
      organization: toOrganizationApiInterface(org),
    };
  }
);
