import { getDataSourceValidator } from "shared/validators";
import {
  getDataSourceById,
  toDataSourceApiInterface,
} from "back-end/src/models/DataSourceModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";

export const getDataSource = createApiRequestHandler(getDataSourceValidator)(
  async (req) => {
    const dataSource = await getDataSourceById(req.context, req.params.id);
    if (!dataSource) {
      throw new NotFoundError("Could not find dataSource with that id");
    }

    return {
      dataSource: toDataSourceApiInterface(dataSource),
    };
  },
);
