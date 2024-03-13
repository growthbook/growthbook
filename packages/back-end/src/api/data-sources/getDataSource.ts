import { getDataSourceValidator } from "@/src/validators/openapi";
import { GetDataSourceResponse } from "@/types/openapi";
import {
  getDataSourceById,
  toDataSourceApiInterface,
} from "@/src/models/DataSourceModel";
import { createApiRequestHandler } from "@/src/util/handler";

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
