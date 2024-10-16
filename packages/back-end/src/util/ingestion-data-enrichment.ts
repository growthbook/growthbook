import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { findAllSDKConnectionsAcrossAllOrgs } from "back-end/src/models/SdkConnectionModel";
import { SdkData } from "back-end/src/validators/ingestion";

export async function generateDataEnrichmentJson(): Promise<SdkData> {
  const sdkConnections = await findAllSDKConnectionsAcrossAllOrgs();
  return Object.fromEntries(
    sdkConnections.map((conn) => [conn.id, sdkInfo(conn)])
  );
}

function sdkInfo(conn: SDKConnectionInterface) {
  return {
    organization: conn.organization,
    client_key: conn.id,
    // TODO: pull datasource
    datasource: "",
  };
}
