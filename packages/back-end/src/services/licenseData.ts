import path from "path";
import fs from "fs";
import md5 from "md5";
import { findAllSDKConnectionsAcrossAllOrgs } from "../models/SdkConnectionModel";
import { getInstallationId } from "../models/InstallationModel";
import { IS_CLOUD } from "../util/secrets";
import { getInstallationDatasources } from "../models/DataSourceModel";
import { OrganizationInterface } from "../../types/organization";
import { getAllInviteEmailsInDb } from "../models/OrganizationModel";
import { UserModel } from "../models/UserModel";
import { logger } from "../util/logger";
import { getUsersByIds } from "./users";

export async function getLicenseMetaData() {
  let installationId = "unknown";
  let gitSha = "";
  let gitCommitDate = "";
  let sdkLanguages: string[] = [];
  let dataSourceTypes: string[] = [];
  let eventTrackers: string[] = [];
  try {
    installationId = await getInstallationId();
    const rootPath = path.join(__dirname, "..", "..", "..", "..");

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

    if (!IS_CLOUD) {
      sdkLanguages = Array.from(
        new Set(
          (await findAllSDKConnectionsAcrossAllOrgs())
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
  } catch (e) {
    logger.error("Error getting license metadata: " + e.message);
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

export async function getUserCodesForOrg(org: OrganizationInterface) {
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
  return userLicenseCodes;
}
