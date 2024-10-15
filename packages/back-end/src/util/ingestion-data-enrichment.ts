import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { findAllSDKConnectionsAcrossAllOrgs } from "back-end/src/models/SdkConnectionModel";

interface SdkInfo {
  orgId: string;
  sdkId: string;
  sdkLanguage: string;
  sdkVersion: string | undefined;
}

interface SdkData {
  [sdkId: string]: SdkInfo;
}

export async function generateDataEnrichmentJson(): Promise<SdkData> {
  const sdkConnections = await findAllSDKConnectionsAcrossAllOrgs();
  return Object.fromEntries(
    sdkConnections.map((conn) => [conn.id, sdkInfo(conn)])
  );
}

function sdkInfo(conn: SDKConnectionInterface) {
  return {
    orgId: conn.organization,
    sdkId: conn.id,
    sdkLanguage: conn.languages[0],
    sdkVersion: conn.sdkVersion,
  };
}
