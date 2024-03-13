import path from "path";
import fs from "fs";
import { licenseInit } from "enterprise";
import { IS_CLOUD } from "@back-end/src/util/secrets";
import { findAllSDKConnections } from "@back-end/src/models/SdkConnectionModel";
import { getInstallationId } from "@back-end/src/models/InstallationModel";
import { getInstallationDatasources } from "@back-end/src/models/DataSourceModel";
import { getUserLicenseCodes } from "./users";

export async function getLicenseMetaData() {
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

    const dataSources = await getInstallationDatasources();
    dataSourceTypes = Array.from(new Set(dataSources.map((ds) => ds.type)));

    eventTrackers = Array.from(
      new Set(dataSources.map((ds) => ds.settings?.schemaFormat ?? "custom"))
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

export async function initializeLicense(
  licenseKey?: string,
  forceRefresh = false
) {
  const key = licenseKey || process.env.LICENSE_KEY;
  if (
    !IS_CLOUD &&
    (!key ||
      key.startsWith("license_") ||
      process.env.LICENSE_KEY?.startsWith("license_"))
  ) {
    const userLicenseCodes = await getUserLicenseCodes();
    const metaData = await getLicenseMetaData();
    return await licenseInit(
      licenseKey,
      userLicenseCodes,
      metaData,
      forceRefresh
    );
  }
  return await licenseInit(licenseKey);
}
