import { ListSdkConnectionsResponse } from "../../../types/openapi";
import {
  findSDKConnectionsByOrganization,
  toApiSDKConnectionInterface,
} from "../../models/SdkConnectionModel";
import { applyPagination, createApiRequestHandler } from "../../util/handler";
import { listSdkConnectionsValidator } from "../../validators/openapi";

export const listSdkConnections = createApiRequestHandler(
  listSdkConnectionsValidator
)(
  async (req): Promise<ListSdkConnectionsResponse> => {
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
