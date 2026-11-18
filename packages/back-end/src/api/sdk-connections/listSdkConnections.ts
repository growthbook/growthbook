import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { listSdkConnectionsValidator } from "shared/validators";
import { stringToBoolean } from "shared/util";
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

export const listSdkConnections = createApiRequestHandler(
  listSdkConnectionsValidator,
)(async (req) => {
  let connections: SDKConnectionInterface[] = [];
  const includeArchived = stringToBoolean(req.query.archived?.toString());

  if (req.query.multiOrg) {
    // Includes every org's signing and encryption keys, which impersonating
    // an org already exposes but read-only access must not
    await validateIsSuperUserRequest(req, "impersonate");
    connections = await findAllSDKConnectionsAcrossAllOrgs();
  } else {
    connections = await findSDKConnectionsByOrganization(req.context);
  }

  const { filtered, returnFields } = applyPagination(
    connections
      .filter(
        (c) =>
          (!req.query.withProxy || c.proxy?.enabled) &&
          // An archived connection serves nothing, so the proxy never gets it.
          ((includeArchived && !req.query.withProxy) || !c.archived) &&
          applyFilter(req.query.projectId, c.projects, true),
      )
      .sort((a, b) => a.dateCreated.getTime() - b.dateCreated.getTime()),
    req.query,
  );

  return {
    connections: filtered.map((connection) =>
      toApiSDKConnectionInterface(connection),
    ),
    ...returnFields,
  };
});
