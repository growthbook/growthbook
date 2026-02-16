import path from "path";
import { fileURLToPath } from "node:url";
import fs from "fs";

const _dir = path.dirname(fileURLToPath(import.meta.url));
import md5 from "md5";
import { LicenseUserCodes } from "shared/enterprise";
import { DefaultMemberRole, OrgMemberInfo } from "shared/types/organization";
import { TeamInterface } from "shared/types/team";
import { findAllSDKConnectionsAcrossAllOrgs } from "back-end/src/models/SdkConnectionModel";
import { getInstallation } from "back-end/src/models/InstallationModel";
import { IS_CLOUD, IS_MULTI_ORG } from "back-end/src/util/secrets";
import { getInstallationDatasources } from "back-end/src/models/DataSourceModel";
import {
  getAllOrgMemberInfoInDb,
  getSelfHostedOrganization,
} from "back-end/src/models/OrganizationModel";
import {
  getUserIdsAndEmailsForAllUsersInDb,
  getUsersByIds,
} from "back-end/src/models/UserModel";
import { logger } from "back-end/src/util/logger";
import {
  getAllTeamRoleInfoInDb,
  getTeamsForOrganization,
} from "back-end/src/models/TeamModel";

export async function getLicenseMetaData() {
  let installationId = "unknown";
  let installationName = "unknown";
  let gitSha = "";
  let gitCommitDate = "";
  let sdkLanguages: string[] = [];
  let dataSourceTypes: string[] = [];
  let eventTrackers: string[] = [];
  try {
    const installation = await getInstallation();
    installationId = installation.id;
    if (IS_CLOUD) {
      installationName = "cloud";
    } else {
      if (IS_MULTI_ORG) {
        installationName = installation.name || installationId;
      } else {
        const org = await getSelfHostedOrganization();
        installationName = org?.name || installationId;
      }
    }

    const rootPath = path.join(_dir, "..", "..", "..", "..");

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
            .flat(),
        ),
      );

      const dataSources = await getInstallationDatasources();
      dataSourceTypes = Array.from(new Set(dataSources.map((ds) => ds.type)));

      eventTrackers = Array.from(
        new Set(dataSources.map((ds) => ds.settings?.schemaFormat ?? "custom")),
      );
    }
  } catch (e) {
    logger.error("Error getting license metadata: " + e.message);
  }

  return {
    installationId,
    installationName,
    gitSha,
    gitCommitDate,
    sdkLanguages: sdkLanguages,
    dataSourceTypes: dataSourceTypes,
    eventTrackers: eventTrackers,
    isCloud: IS_CLOUD,
  };
}

function isReadOnlyRole(role: DefaultMemberRole): boolean {
  return role === "readonly" || role === "noaccess";
}

function getMemberRoles(
  orgs: OrgMemberInfo[],
  memberId: string,
  teamIdToTeamMap: {
    [key: string]: TeamInterface;
  },
) {
  const roles: string[] = [];

  orgs.forEach((org) => {
    const member = org.members.find((m) => m.id === memberId);
    if (member) {
      // Global roles
      roles.push(member.role);

      // Project roles
      if (member.projectRoles) {
        roles.push(...member.projectRoles.map((pr) => pr.role));
      }

      member.teams?.forEach((teamId) => {
        const team = teamIdToTeamMap[teamId];
        if (!team) {
          return;
        }

        // Global Team Role
        roles.push(team.role);

        // Team project roles
        if (team.projectRoles) {
          roles.push(...team.projectRoles.map((pr) => pr.role));
        }
      });
    }
  });

  return roles;
}

export async function getUserCodesForOrg(
  org: OrgMemberInfo,
): Promise<LicenseUserCodes> {
  const fullMembersSet: Set<string> = new Set([]);
  const readOnlyMembersSet: Set<string> = new Set([]);
  let invitesSet: Set<string> = new Set([]);

  let organizations: OrgMemberInfo[] = [];
  let users: { id: string; email: string }[] = [];
  let teams: TeamInterface[] = [];

  if (IS_CLOUD) {
    organizations = [org];
    const memberIds = org.members.map((member) => member.id);
    users = await getUsersByIds(memberIds);
    teams = await getTeamsForOrganization(org.id);
  } else {
    // Self-Host, might be multi-org so we have to look across all orgs
    organizations = await getAllOrgMemberInfoInDb();
    users = await getUserIdsAndEmailsForAllUsersInDb();
    teams = await getAllTeamRoleInfoInDb();
  }

  const userIdsToEmailHash = users.reduce(
    (acc: { [key: string]: string }, user) => {
      acc[user.id] = md5(user.email).slice(0, 8);
      return acc;
    },
    {},
  );

  const teamIdToTeamMap = teams.reduce(
    (
      acc: {
        [key: string]: TeamInterface;
      },
      team,
    ) => {
      acc[team.id] = team;
      return acc;
    },
    {},
  );

  for (const userId of Object.keys(userIdsToEmailHash)) {
    const roles = getMemberRoles(organizations, userId, teamIdToTeamMap);
    if (roles.length === 0) {
      // an orphaned user, skip
      continue;
    }
    const isReadOnly = roles.every(isReadOnlyRole);
    const emailHash = userIdsToEmailHash[userId];

    if (isReadOnly) {
      readOnlyMembersSet.add(emailHash);
    } else {
      fullMembersSet.add(emailHash);
    }
  }

  invitesSet = new Set(
    organizations.reduce((emails: string[], organization) => {
      const inviteEmails = organization.invites.map((invite) =>
        md5(invite.email).slice(0, 8),
      );
      return emails.concat(inviteEmails);
    }, []),
  );

  const fullMembers = Array.from(fullMembersSet);
  // if a read only member is a full member in another organization, they should be counted as a full member and not appear as a read only member
  const readOnlyMembers = Array.from(readOnlyMembersSet).filter(
    (readOnlyMember) => !fullMembersSet.has(readOnlyMember),
  );
  // if an invite is a full member or a readOnly Member in another organization, they should be counted as such and not as an invite
  const invites = Array.from(invitesSet).filter(
    (invite) => !fullMembersSet.has(invite) && !readOnlyMembersSet.has(invite),
  );

  return {
    fullMembers,
    readOnlyMembers,
    invites,
  };
}
