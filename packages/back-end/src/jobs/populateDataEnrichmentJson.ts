import {
  findAllSDKConnectionsAcrossAllOrgs,
  findSdkConnectionByIdAcrossOrganizations,
} from "back-end/src/models/SdkConnectionModel";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { getS3 } from "back-end/src/services/files";

const DATA_ENRICHMENT_BUCKET = "growthbook-ingestion-data-enrichment";

interface SdkInfo {
  orgId: string;
  sdkId: string;
  sdkLanguage: string;
  sdkVersion: string | undefined;
}

interface SdkData {
  [sdkId: string]: SdkInfo;
}

// For generating the json blob of sdk ids -> org data and writing it to s3
export async function updateDataEnrichmentJson(sdkId: string) {
  if (!hasS3Credentials()) return;
  const currentData = await readDataEnrichmentJson();
  let newData = currentData;
  if (Object.keys(currentData).length === 0) {
    newData = await generateFullDataEnrichmentJson();
  } else {
    const singleSdkInfo = await generateSingleSdkInfo(sdkId);
    if (!singleSdkInfo) {
      delete newData[sdkId];
    } else {
      newData[singleSdkInfo.sdkId] = singleSdkInfo;
    }
  }
  await writeDataEnrichmentJson(newData);
}

async function readDataEnrichmentJson(): Promise<SdkData> {
  return {};
}

async function generateFullDataEnrichmentJson(): Promise<SdkData> {
  const sdkConnections = await findAllSDKConnectionsAcrossAllOrgs();
  return Object.fromEntries(
    sdkConnections.map((conn) => [conn.id, sdkInfo(conn)])
  );
}

async function generateSingleSdkInfo(sdkId: string): Promise<SdkInfo | null> {
  const conn = await findSdkConnectionByIdAcrossOrganizations(sdkId);
  if (!conn) {
    return null;
  } else {
    return sdkInfo(conn);
  }
}

async function writeDataEnrichmentJson(sdkData: SdkData) {
  const s3 = getS3();
  await s3
    .upload({
      Bucket: `${DATA_ENRICHMENT_BUCKET}/${process.env.NODE_ENV}`,
      Key: "sdk_data.json",
      Body: Buffer.from(JSON.stringify(sdkData), "binary"),
      ContentType: "application/json",
    })
    .promise();
}

function hasS3Credentials(): boolean {
  return false;
}

function sdkInfo(conn: SDKConnectionInterface) {
  return {
    orgId: conn.organization,
    sdkId: conn.id,
    sdkLanguage: conn.languages[0],
    sdkVersion: conn.sdkVersion,
  };
}
