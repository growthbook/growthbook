import uniqid from "uniqid";
import { PostDimensionResponse } from "shared/types/openapi";
import { postDimensionValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  createDimension,
  toDimensionApiInterface,
} from "back-end/src/models/DimensionModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";

export const postDimension = createApiRequestHandler(postDimensionValidator)(
  async (req): Promise<PostDimensionResponse> => {
    const organization = req.organization.id;

    const datasourceDoc = await getDataSourceById(
      req.context,
      req.body.datasourceId,
    );
    if (!datasourceDoc) {
      throw new Error("Invalid data source");
    }

    const dimension = await createDimension({
      datasource: req.body.datasourceId,
      userIdType: req.body.identifierType,
      owner: req.body.owner || "",
      name: req.body.name,
      description: req.body.description || "",
      sql: req.body.query,
      id: uniqid("dim_"),
      dateCreated: new Date(),
      dateUpdated: new Date(),
      managedBy: req.body.managedBy || "",
      organization,
    });

    return {
      dimension: toDimensionApiInterface(dimension),
    };
  },
);
