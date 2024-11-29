import { ListSdkConnectionsResponse } from "back-end/types/openapi";
import {
  findAllSDKConnectionsAcrossAllOrgs,
  findSDKConnectionsByOrganization,
  toApiSDKConnectionInterface,
} from "back-end/src/models/SdkConnectionModel";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
  validateIsSuperUserRequest,
} from "back-end/src/util/handler";
import { listSdkConnectionsValidator } from "back-end/src/validators/openapi";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";

export const listSdkConnections = createApiRequestHandler(
  listSdkConnectionsValidator
)(
  async (req): Promise<ListSdkConnectionsResponse> => {
    let connections: SDKConnectionInterface[] = [];

    if (req.query.multiOrg) {
      await validateIsSuperUserRequest(req);
      connections = await findAllSDKConnectionsAcrossAllOrgs();
    } else {
      connections = await findSDKConnectionsByOrganization(req.context);
    }

    const { filtered, returnFields } = applyPagination(
      connections
        .filter(
          (c) =>
            (!req.query.withProxy || c.proxy?.enabled) &&
            applyFilter(req.query.projectId, c.projects, true)
        )
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
