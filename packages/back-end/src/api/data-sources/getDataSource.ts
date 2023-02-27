import { z } from "zod";
import { GetDataSourceResponse } from "../../../types/openapi";
import {
  getDataSourceById,
  toDataSourceApiInterface,
} from "../../models/DataSourceModel";
import { createApiRequestHandler } from "../../util/handler";

export const getDataSource = createApiRequestHandler({
  paramsSchema: z
    .object({
      id: z.string(),
    })
    .strict(),
})(
  async (req): Promise<GetDataSourceResponse> => {
    const dataSource = await getDataSourceById(
      req.params.id,
      req.organization.id
    );
    if (!dataSource) {
      throw new Error("Could not find dataSource with that id");
    }

    return {
      dataSource: toDataSourceApiInterface(dataSource),
    };
  }
);
