import { GetDataSourceResponse } from "shared/types/openapi";
import { getDataSourceValidator } from "shared/validators";
import {
  getDataSourceById,
  toDataSourceApiInterface,
} from "back-end/src/models/DataSourceModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getDataSource = createApiRequestHandler(getDataSourceValidator)(
  async (req): Promise<GetDataSourceResponse> => {
    const dataSource = await getDataSourceById(req.context, req.params.id);
    if (!dataSource) {
      throw new Error("Could not find dataSource with that id");
    }

    return {
      dataSource: toDataSourceApiInterface(dataSource),
    };
  },
);
