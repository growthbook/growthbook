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

    return {
      environments: (org.settings?.environments || []).map(
        ({ id, description, toggleOnList, defaultState }) => ({
          id,
          description: description || "",
          defaultState: !!defaultState,
          toggleOnList: !!toggleOnList,
        })
      ),
    };
  }
);
