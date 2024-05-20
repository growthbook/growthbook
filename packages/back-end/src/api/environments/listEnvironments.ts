import { ListEnvironmentsResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { findOrganizationById } from "../../models/OrganizationModel";
import { listEnvironmentsValidator } from "../../validators/openapi";

export const listEnvironments = createApiRequestHandler(
  listEnvironmentsValidator
)(
  async (req): Promise<ListEnvironmentsResponse> => {
    const id = req.params.id;

    const org = await findOrganizationById(id);
    if (!org) {
      throw Error("Organization not found");
    }

    const environments = (
      org.settings?.environments || []
    ).filter((environment) =>
      req.context.permissions.canReadMultiProjectResource(environment.projects)
    );

    return {
      environments: environments.map(
        ({
          id,
          description = "",
          toggleOnList = false,
          defaultState = false,
          projects = [],
        }) => ({
          id,
          projects,
          description,
          defaultState,
          toggleOnList,
        })
      ),
    };
  }
);
