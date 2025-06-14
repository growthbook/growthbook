import { GetOrganizationDefaultsResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getOrganizationDefaultsValidator } from "back-end/src/validators/openapi";
import {
  toOrganizationDefaultsApiInterface,
  findOrganizationById,
} from "back-end/src/models/OrganizationModel";

export const getOrganizationDefaults = createApiRequestHandler(
  getOrganizationDefaultsValidator
)(
  async (req): Promise<GetOrganizationDefaultsResponse> => {
    const org = await findOrganizationById(req.context.org.id);
    if (!org) {
      throw new Error(
        `A Organization with id ${req.context.org.id} does not exist`
      );
    }

    return {
      organizationDefaults: await toOrganizationDefaultsApiInterface(org),
    };
  }
);
