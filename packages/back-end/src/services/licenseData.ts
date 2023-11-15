import path from "path";
import fs from "fs";
import { licenseInit } from "enterprise";
import { findAllSDKConnections } from "../models/SdkConnectionModel";
import { getInstallationId } from "../models/InstallationModel";
import { IS_CLOUD } from "../util/secrets";
import { getAllDataSources } from "../models/DataSourceModel";
import { getUserLicenseCodes } from "./users";

async function getMetaData() {
  const installationId = await getInstallationId();
  const rootPath = path.join(__dirname, "..", "..", "..", "..");

  let gitSha = "";
  let gitCommitDate = "";
  if (fs.existsSync(path.join(rootPath, "buildinfo", "SHA"))) {
    gitSha = fs
      .readFileSync(path.join(rootPath, "buildinfo", "SHA"))
      .toString();
  }
  if (fs.existsSync(path.join(rootPath, "buildinfo", "DATE"))) {
    gitCommitDate = fs
      .readFileSync(path.join(rootPath, "buildinfo", "DATE"))
      .toString();
  }

  let sdkLanguages: string[] = [];
  let dataSourceTypes: string[] = [];
  let eventTrackers: string[] = [];

  if (!IS_CLOUD) {
    sdkLanguages = Array.from(
      new Set(
        (await findAllSDKConnections())
          .map((connection) => connection.languages)
          .flat()
      )
    );

    const dataSources = await getAllDataSources();
    dataSourceTypes = Array.from(new Set(dataSources.map((ds) => ds.type)));

    eventTrackers = Array.from(
      new Set(dataSources.map((ds) => ds.settings.schemaFormat ?? "custom"))
    );
  }

  return {
    installationId,
    gitSha,
    gitCommitDate,
    sdkLanguages: sdkLanguages,
    dataSourceTypes: dataSourceTypes,
    eventTrackers: eventTrackers,
    isCloud: IS_CLOUD,
  };
}

export async function initializeLicense(licenseKey?: string) {
  const userLicenseCodes = IS_CLOUD ? [] : await getUserLicenseCodes();
  const metaData = await getMetaData();
  await licenseInit(userLicenseCodes, metaData, licenseKey);
}
