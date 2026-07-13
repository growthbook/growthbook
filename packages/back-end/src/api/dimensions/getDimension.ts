import { getDimensionValidator } from "shared/validators";
import {
  findDimensionById,
  toDimensionApiInterface,
} from "back-end/src/models/DimensionModel";
import {
  getAllDatasourceIdsByOrganization,
  getDataSourceById,
} from "back-end/src/models/DataSourceModel";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getDimension = createApiRequestHandler(getDimensionValidator)(
  async (req) => {
    const dimension = await findDimensionById(
      req.params.id,
      req.organization.id,
    );
    if (!dimension) {
      throw new Error("Could not find dimension with that id");
    }

    // A dimension inherits project access from its datasource. Hide it only when
    // the datasource exists but is inaccessible; orphaned dimensions whose
    // datasource no longer exists stay reachable.
    if (
      dimension.datasource &&
      !(await getDataSourceById(req.context, dimension.datasource)) &&
      (await getAllDatasourceIdsByOrganization(req.context)).has(
        dimension.datasource,
      )
    ) {
      throw new Error("Could not find dimension with that id");
    }

    return {
      dimension: await resolveOwnerEmail(
        toDimensionApiInterface(dimension),
        req.context,
      ),
    };
  },
);
