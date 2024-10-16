import {
  createApiRequestHandler,
  validateIsSuperUserRequest,
} from "back-end/src/util/handler";
import { getDataEnrichmentValidator } from "back-end/src/validators/openapi";
import { GetDataEnrichmentResponse } from "back-end/types/openapi";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { findAllSDKConnectionsAcrossAllOrgs } from "back-end/src/models/SdkConnectionModel";

export const getDataEnrichment = createApiRequestHandler(
  getDataEnrichmentValidator
)(
  async (req): Promise<GetDataEnrichmentResponse> => {
    validateIsSuperUserRequest(req);
    const sdkConnections = await findAllSDKConnectionsAcrossAllOrgs();
    const sdkData = Object.fromEntries(
      sdkConnections.map((conn) => [conn.id, sdkInfo(conn)])
    );

    return { sdkData };
  }
);

function sdkInfo(conn: SDKConnectionInterface) {
  return {
    organization: conn.organization,
    client_key: conn.id,
    // TODO: pull datasource
    datasource: "",
  };
}
