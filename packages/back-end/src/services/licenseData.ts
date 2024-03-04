import path from "path";
import fs from "fs";
import { licenseInit } from "enterprise";
import md5 from "md5";
import { findAllSDKConnections } from "../models/SdkConnectionModel";
import { getInstallationId } from "../models/InstallationModel";
import { IS_CLOUD } from "../util/secrets";
import { getInstallationDatasources } from "../models/DataSourceModel";
import { OrganizationInterface } from "../../types/organization";
import {
  getAllInviteEmailsInDb,
  getOrganization,
} from "../models/OrganizationModel";
import { UserModel } from "../models/UserModel";
import { getUsersByIds } from "./users";

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

export async function initializeLicenseForOrg(
  reqOrg?: OrganizationInterface,
  forceRefresh = false
) {
  let org = reqOrg;
  if (!org) {
    // When we initialize the app, we don't have a request with an org yet.
    if (IS_CLOUD) {
      // On cloud we will initialize license on an as need basis once we know the org of a request
      return;
    }

    // For self-hosted there is either
    // no orgs upon first initialization - in which case we get the key from the env var
    // exactly one org normally - in which case we get the key from the org
    // or multiple orgs if it is a MULTI_ORG site - in which case the org is not allowed to have a license key and we shall also fall back to the env var
    org = (await getOrganization()) || undefined;
  }

  const key = org?.licenseKey || process.env.LICENSE_KEY;

  if (!key) {
    return;
  }

  if (key.startsWith("license_")) {
    let userLicenseCodes: string[] = [];
    if (IS_CLOUD && org) {
      const memberIds = org.members.map((member) => member.id);
      const memberEmails = (await getUsersByIds(memberIds)).map(
        (user) => user.email
      );
      const inviteEmails = org.invites.map((invite) => invite.email);
      const membersAndInviteEmails = memberEmails.concat(inviteEmails);
      userLicenseCodes = membersAndInviteEmails.map((email) => {
        return md5(email).slice(0, 8);
      });
    } else {
      // Self-Host logic
      // get all users and invites codes across all orgs in the db
      // that are part of at least one organization
      // there may be multiple orgs in case it is a MULTI_ORG site
      const users = await UserModel.aggregate([
        {
          $lookup: {
            from: "organizations",
            localField: "id",
            foreignField: "members.id",
            as: "orgs",
          },
        },
        {
          $match: {
            "orgs.0": { $exists: true },
          },
        },
      ]);

      const userEmailCodes = await Promise.all(
        users.map(async (user) => {
          return md5(user.email).slice(0, 8);
        })
      );

      const inviteEmails = await getAllInviteEmailsInDb();
      const inviteEmailCodes: string[] = inviteEmails.map((email) => {
        return md5(email).slice(0, 8);
      });

      userLicenseCodes = Array.from(
        new Set(userEmailCodes.concat(inviteEmailCodes))
      );
    }

    const metaData = await getLicenseMetaData();
    return await licenseInit(key, userLicenseCodes, metaData, forceRefresh);
  }
  return await licenseInit(key);
}
