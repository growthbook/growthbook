import { GetDataSourceResponse } from "../../../types/openapi";
import {
  getDataSourceById,
  toDataSourceApiInterface,
} from "../../models/DataSourceModel";
import { createApiRequestHandler } from "../../util/handler";
import { getDataSourceValidator } from "../../validators/openapi";

export const getDataSource = createApiRequestHandler(getDataSourceValidator)(
  async (req): Promise<GetDataSourceResponse> => {
    const dataSource = await getDataSourceById(req.context, req.params.id);
    if (!dataSource) {
      throw new Error("Could not find dataSource with that id");
    }

    return {
      dataSource: toDataSourceApiInterface(dataSource),
    };
  }
);
