import { z } from "zod";
import {
  ApiPaginationFields,
  ApiSDKConnectionInterface,
} from "../../../types/api";
import {
  findSDKConnectionsByOrganization,
  toApiSDKConnectionInterface,
} from "../../models/SdkConnectionModel";
import { applyPagination, createApiRequestHandler } from "../../util/handler";

export const listSDKConnections = createApiRequestHandler({
  querySchema: z
    .object({
      limit: z.string().optional(),
      offset: z.string().optional(),
      withProxy: z.string().optional(),
    })
    .strict(),
})(
  async (
    req
  ): Promise<
    ApiPaginationFields & { connections: ApiSDKConnectionInterface[] }
  > => {
    const connections = await findSDKConnectionsByOrganization(
      req.organization.id
    );

    const { filtered, returnFields } = applyPagination(
      connections
        .filter((c) => {
          if (!req.query.withProxy) return true;
          return c.proxy?.enabled;
        })
        .sort((a, b) => a.dateCreated.getTime() - b.dateCreated.getTime()),
      req.query
    );

    return {
      connections: filtered.map((connection) =>
        toApiSDKConnectionInterface(connection)
      ),
      ...returnFields,
    };
  }
);
