import { z } from "zod";
import {
  createApiRequestHandler,
  validateIsSuperUserRequest,
} from "back-end/src/util/handler";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { findAllSDKConnectionsAcrossAllOrgs } from "back-end/src/models/SdkConnectionModel";

interface GetDataEnrichmentResponse {
  sdkData: {
    [key: string]: {
      client_key: string;
      organization: string;
      datasource: string;
    };
  };
}

export const getDataEnrichment = createApiRequestHandler({
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
})(
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
