import { getDimensionValidator } from "shared/validators";
import {
  findDimensionById,
  toDimensionApiInterface,
} from "back-end/src/models/DimensionModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getDimension = createApiRequestHandler(getDimensionValidator)(
  async (req) => {
    const dimension = await findDimensionById(
      req.params.id,
      req.organization.id,
    );
    // A dimension's project access is inherited from its datasource, which
    // returns null when the caller lacks access to its projects.
    if (
      !dimension ||
      !(await getDataSourceById(req.context, dimension.datasource))
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
