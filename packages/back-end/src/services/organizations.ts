import { randomBytes } from "crypto";
import { freeEmailDomains } from "free-email-domains-typescript";
import { cloneDeep } from "lodash";
import {
  FULL_ACCESS_PERMISSIONS,
  getReadAccessFilter,
} from "shared/permissions";
import {
  createOrganization,
  findAllOrganizations,
  findOrganizationById,
  findOrganizationByInviteKey,
  findOrganizationsByDomain,
  updateOrganization,
} from "../models/OrganizationModel";
import { APP_ORIGIN, IS_CLOUD } from "../util/secrets";
import { AuthRequest } from "../types/AuthRequest";
import { UserModel } from "../models/UserModel";
import {
  ExpandedMember,
  Invite,
  Member,
  MemberRole,
  MemberRoleInfo,
  MemberRoleWithProjects,
  OrganizationInterface,
  PendingMember,
  ProjectMemberRole,
  ReqContext,
} from "../../types/organization";
import { ApiReqContext, ExperimentOverride } from "../../types/api";
import { ConfigFile } from "../init/config";
import {
  createDataSource,
  getDataSourceById,
  updateDataSource,
} from "../models/DataSourceModel";
import {
  ALLOWED_METRIC_TYPES,
  getMetricById,
  updateMetric,
} from "../models/MetricModel";
import { MetricInterface } from "../../types/metric";
import {
  createDimension,
  findDimensionById,
  updateDimension,
} from "../models/DimensionModel";
import { DimensionInterface } from "../../types/dimension";
import { DataSourceInterface } from "../../types/datasource";
import { SSOConnectionInterface } from "../../types/sso-connection";
import { logger } from "../util/logger";
import { getDefaultRole, getUserPermissions } from "../util/organization.util";
import { SegmentInterface } from "../../types/segment";
import {
  createSegment,
  findSegmentById,
  updateSegment,
} from "../models/SegmentModel";
import { getAllExperiments } from "../models/ExperimentModel";
import { LegacyExperimentPhase } from "../../types/experiment";
import { addTags } from "../models/TagModel";
import { markInstalled } from "./auth";
import {
  encryptParams,
  getSourceIntegrationObject,
  mergeParams,
} from "./datasource";
import { createMetric } from "./experiments";
import { isEmailEnabled, sendInviteEmail, sendNewMemberEmail } from "./email";
import { getUsersByIds } from "./users";

export async function getOrganizationById(id: string) {
  return findOrganizationById(id);
}

export function validateLoginMethod(
  org: OrganizationInterface,
  req: AuthRequest
) {
  if (
    org.restrictLoginMethod &&
    req.loginMethod?.id !== org.restrictLoginMethod
  ) {
    throw new Error(
      "Your organization requires you to login with Enterprise SSO"
    );
  }

  // If the org requires a specific subject in the IdToken
  // This is mostly used with GrowthBook Cloud to restrict people to "Login with Google"
  // For that, we set `restrictAuthSubPrefix` to "google"
  if (
    org.restrictAuthSubPrefix &&
    !req.authSubject?.startsWith(org.restrictAuthSubPrefix)
  ) {
    throw new Error(
      `Your organization requires you to login with ${org.restrictAuthSubPrefix}`
    );
  }

  return true;
}

export function getContextFromReq(req: AuthRequest): ReqContext {
  if (!req.organization) {
    throw new Error("Must be part of an organization to make that request");
  }
  if (!req.userId || !req.email) {
    throw new Error("Must be logged in");
  }

  return {
    org: req.organization,
    userId: req.userId,
    email: req.email,
    environments: getEnvironmentIdsFromOrg(req.organization),
    userName: req.name || "",
    readAccessFilter: getReadAccessFilter(
      getUserPermissions(req.userId, req.organization, req.teams)
    ),
    auditUser: {
      type: "dashboard",
      id: req.userId,
      email: req.email,
      name: req.name || "",
    },
  };
}

export function getEnvironmentIdsFromOrg(org: OrganizationInterface): string[] {
  return getEnvironments(org).map((e) => e.id);
}

export function getEnvironments(org: OrganizationInterface) {
  if (!org.settings?.environments || !org.settings?.environments?.length) {
    return [
      {
        id: "dev",
        description: "",
        toggleOnList: true,
      },
      {
        id: "production",
        description: "",
        toggleOnList: true,
      },
    ];
  }
  return org.settings.environments;
}

export async function getConfidenceLevelsForOrg(id: string) {
  const org = await getOrganizationById(id);
  const ciUpper = org?.settings?.confidenceLevel || 0.95;
  return {
    ciUpper,
    ciLower: 1 - ciUpper,
    ciUpperDisplay: Math.round(ciUpper * 100) + "%",
    ciLowerDisplay: Math.round((1 - ciUpper) * 100) + "%",
  };
}

export function getRole(
  org: OrganizationInterface,
  userId: string,
  project?: string
): MemberRoleInfo {
  const member = org.members.find((m) => m.id === userId);

  if (member) {
    // Project-specific role
    if (project && member.projectRoles) {
      const projectRole = member.projectRoles.find(
        (r) => r.project === project
      );
      if (projectRole) {
        return projectRole;
      }
    }

    // Global role
    return {
      role: member.role,
      limitAccessByEnvironment: !!member.limitAccessByEnvironment,
      environments: member.environments || [],
    };
  }

  return getDefaultRole(org);
}

export function getNumberOfUniqueMembersAndInvites(
  organization: OrganizationInterface
) {
  // There was a bug that allowed duplicate members in the members array
  const numMembers = new Set(organization.members.map((m) => m.id)).size;
  const numInvites = new Set(organization.invites.map((i) => i.email)).size;

  return numMembers + numInvites;
}

export async function userHasAccess(
  req: AuthRequest,
  organization: string
): Promise<boolean> {
  if (req.superAdmin) return true;
  if (req.organization?.id === organization) return true;
  if (!req.userId) return false;

  const doc = await getOrganizationById(organization);
  if (doc && doc.members.map((m) => m.id).includes(req.userId)) {
    return true;
  }
  return false;
}

export async function removeMember(
  organization: OrganizationInterface,
  id: string
) {
  const members = organization.members.filter((member) => member.id !== id);
  const pendingMembers = (organization?.pendingMembers || []).filter(
    (member) => member.id !== id
  );

  if (!members.length) {
    throw new Error("Organizations must have at least 1 member");
  }

  await updateOrganization(organization.id, {
    members,
    pendingMembers,
  });

  return organization;
}

export async function revokeInvite(
  organization: OrganizationInterface,
  key: string
) {
  const invites = organization.invites.filter((invite) => invite.key !== key);

  await updateOrganization(organization.id, {
    invites,
  });

  return organization;
}

export function getInviteUrl(key: string) {
  return `${APP_ORIGIN}/invitation?key=${key}`;
}

export async function addMemberToOrg({
  organization,
  userId,
  role,
  environments,
  limitAccessByEnvironment,
  projectRoles,
  externalId,
  managedByIdp,
}: {
  organization: OrganizationInterface;
  userId: string;
  role: MemberRole;
  limitAccessByEnvironment: boolean;
  environments: string[];
  projectRoles?: ProjectMemberRole[];
  externalId?: string;
  managedByIdp?: boolean;
}) {
  // If member is already in the org, skip
  if (organization.members.find((m) => m.id === userId)) {
    return;
  }
  // If member is also a pending member, remove
  let pendingMembers: PendingMember[] = organization?.pendingMembers || [];
  pendingMembers = pendingMembers.filter((m) => m.id !== userId);

  const members: Member[] = [
    ...organization.members,
    {
      id: userId,
      role,
      limitAccessByEnvironment,
      environments,
      projectRoles,
      dateCreated: new Date(),
      externalId,
      managedByIdp,
    },
  ];

  await updateOrganization(organization.id, {
    members,
    pendingMembers,
  });
}

export async function addMembersToTeam({
  organization,
  userIds,
  teamId,
}: {
  organization: OrganizationInterface;
  userIds: string[];
  teamId: string;
}): Promise<void> {
  const updatedMembers = organization.members.map((member) => {
    if (!userIds.includes(member.id) || member.teams?.includes(teamId)) {
      return member;
    }

    return { ...member, teams: [...(member.teams ?? []), teamId] };
  });

  await updateOrganization(organization.id, { members: updatedMembers });
}

export async function convertMemberToManagedByIdp({
  organization,
  userId,
  externalId,
}: {
  organization: OrganizationInterface;
  userId: string;
  externalId?: string;
}) {
  const newMembers = cloneDeep(organization.members);

  const memberToUpdate = newMembers.find((member) => member.id === userId);

  if (!memberToUpdate) {
    throw new Error(
      "Tried to update a member that does not exist in the organization"
    );
  }

  memberToUpdate.externalId = externalId;
  memberToUpdate.managedByIdp = true;

  return await updateOrganization(organization.id, { members: newMembers });
}

export async function removeMembersFromTeam({
  organization,
  userIds,
  teamId,
}: {
  organization: OrganizationInterface;
  userIds: string[];
  teamId: string;
}): Promise<void> {
  const updatedMembers = organization.members.map((member) => {
    if (!userIds.includes(member.id)) {
      return member;
    }

    return { ...member, teams: member.teams?.filter((t) => t !== teamId) };
  });

  await updateOrganization(organization.id, { members: updatedMembers });
}

export async function addPendingMemberToOrg({
  organization,
  name,
  userId,
  email,
  role,
  environments,
  limitAccessByEnvironment,
  projectRoles,
}: {
  organization: OrganizationInterface;
  name: string;
  userId: string;
  email: string;
  role: MemberRole;
  limitAccessByEnvironment: boolean;
  environments: string[];
  projectRoles?: ProjectMemberRole[];
}) {
  // If member is already in the org, skip
  if (organization.members.find((m) => m.id === userId)) {
    return;
  }
  // If member is also a pending member, skip
  if (organization?.pendingMembers?.find((m) => m.id === userId)) {
    return;
  }

  const pendingMembers: PendingMember[] = [
    ...(organization.pendingMembers || []),
    {
      id: userId,
      name,
      email,
      role,
      limitAccessByEnvironment,
      environments,
      projectRoles,
      dateCreated: new Date(),
    },
  ];

  await updateOrganization(organization.id, { pendingMembers });
}

export async function acceptInvite(key: string, userId: string) {
  const organization = await findOrganizationByInviteKey(key);
  if (!organization) {
    throw new Error("Invalid key");
  }

  // If member is already in the org, skip so they don't get added to organization.members a second time causing duplicates.
  if (organization.members.find((m) => m.id === userId)) {
    throw new Error(
      "Whoops! You're already a user, you can't accept a new invitation."
    );
  }

  const invite = organization.invites.filter((invite) => invite.key === key)[0];
  if (!invite) {
    throw new Error("Could not find invitation with that key");
  }

  // Remove invite
  const invites = organization.invites.filter((invite) => invite.key !== key);
  // Remove from pending members
  const pendingMembers = (organization?.pendingMembers || []).filter(
    (m) => m.id !== userId
  );

  // Add to member list
  const members: Member[] = [
    ...organization.members,
    {
      id: userId,
      role: invite.role || "admin",
      limitAccessByEnvironment: !!invite.limitAccessByEnvironment,
      environments: invite.environments || [],
      dateCreated: new Date(),
    },
  ];

  await updateOrganization(organization.id, {
    invites,
    members,
    pendingMembers,
  });

  return organization;
}

export async function inviteUser({
  organization,
  email,
  role = "admin",
  limitAccessByEnvironment,
  environments,
  projectRoles,
}: {
  organization: OrganizationInterface;
  email: string;
} & MemberRoleWithProjects) {
  organization.invites = organization.invites || [];

  // User is already invited
  if (
    organization.invites.filter((invite) => invite.email === email).length > 0
  ) {
    return {
      emailSent: true,
      inviteUrl: getInviteUrl(
        organization.invites.filter((invite) => invite.email === email)[0].key
      ),
    };
  }

  // Generate random key for invite
  const buffer: Buffer = await new Promise((resolve, reject) => {
    randomBytes(32, function (ex, buffer) {
      if (ex) {
        reject("error generating token");
      }
      resolve(buffer);
    });
  });
  const key = buffer.toString("base64").replace(/[^a-zA-Z0-9]+/g, "");

  // Save invite in Mongo
  const invites: Invite[] = [
    ...organization.invites,
    {
      email,
      key,
      dateCreated: new Date(),
      role,
      limitAccessByEnvironment,
      environments,
      projectRoles,
    },
  ];

  await updateOrganization(organization.id, {
    invites,
  });

  // append the new invites to the existin object (or refetch)
  organization.invites = invites;

  let emailSent = false;
  if (isEmailEnabled()) {
    try {
      await sendInviteEmail(organization, key);
      emailSent = true;
    } catch (e) {
      logger.error(e, "Error sending invite email");
      emailSent = false;
    }
  }

  return {
    emailSent,
    inviteUrl: getInviteUrl(key),
  };
}

function validateId(id: string) {
  if (!id.match(/^[a-zA-Z_][a-zA-Z0-9_-]*$/)) {
    throw new Error(
      "Invalid id (must be only alphanumeric plus underscores and hyphens)"
    );
  }
}

function validateConfig(config: ConfigFile, organizationId: string) {
  const errors: string[] = [];

  const datasourceIds: string[] = [];
  if (config.datasources) {
    Object.keys(config.datasources).forEach((k) => {
      try {
        datasourceIds.push(k);
        validateId(k);
        const ds = config.datasources?.[k];
        if (!ds) return;

        const { params, ...props } = ds;

        // This will throw an error if something required is missing
        getSourceIntegrationObject({
          ...props,
          params: encryptParams(params),
          id: k,
          organization: organizationId,
          dateCreated: new Date(),
          dateUpdated: new Date(),
        } as DataSourceInterface);
      } catch (e) {
        errors.push(`Data source ${k}: ${e.message}`);
      }
    });
  }

  if (config.metrics) {
    Object.keys(config.metrics).forEach((k) => {
      try {
        validateId(k);
        const metric = config.metrics?.[k];
        if (!metric) return;
        if (metric.datasource && !datasourceIds.includes(metric.datasource)) {
          throw new Error("Unknown datasource id '" + metric.datasource + "'");
        }
        if (!ALLOWED_METRIC_TYPES.includes(metric.type)) {
          throw new Error("Invalid type '" + metric.type + "'");
        }
      } catch (e) {
        errors.push(`Metric ${k}: ${e.message}`);
      }
    });
  }

  if (config.dimensions) {
    Object.keys(config.dimensions).forEach((k) => {
      try {
        validateId(k);
        const dimension = config.dimensions?.[k];
        if (!dimension) return;
        if (!dimension.datasource) {
          throw new Error("Must specify a datasource");
        }
        if (!datasourceIds.includes(dimension.datasource)) {
          throw new Error(
            "Unknown datasource id '" + dimension.datasource + "'"
          );
        }
        if (!dimension.sql) {
          throw new Error("Must specify sql");
        }
      } catch (e) {
        errors.push(`Dimension ${k}: ${e.message}`);
      }
    });
  }

  return errors;
}

export async function importConfig(
  context: ReqContext | ApiReqContext,
  config: ConfigFile
) {
  const organization = context.org;
  const errors = validateConfig(config, organization.id);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  if (config.organization?.settings) {
    await updateOrganization(organization.id, {
      settings: {
        ...organization.settings,
        ...config.organization.settings,
      },
    });
  }
  if (config.datasources) {
    await Promise.all(
      Object.keys(config.datasources).map(async (k) => {
        const ds = config.datasources?.[k];
        if (!ds) return;
        k = k.toLowerCase();
        try {
          if (ds?.params && "privateKey" in ds.params) {
            // Fix newlines in the private keys:
            ds.params.privateKey = ds.params?.privateKey?.replace(/\\n/g, "\n");
          }
          const existing = await getDataSourceById(context, k);
          if (existing) {
            let params = existing.params;
            // If params are changing, merge them with existing and test the connection
            if (ds.params) {
              const integration = getSourceIntegrationObject(existing);
              mergeParams(integration, ds.params);
              await integration.testConnection();
              params = encryptParams(integration.params);
            }

            const updates: Partial<DataSourceInterface> = {
              name: ds.name || existing.name,
              description: ds.description || existing.description,
              type: ds.type || existing.type,
              params,
              settings: {
                ...existing.settings,
                ...ds.settings,
                queries: {
                  ...existing.settings.queries,
                  ...ds.settings?.queries,
                },
                events: {
                  ...existing.settings?.events,
                  ...ds.settings?.events,
                },
              },
            };
            await updateDataSource(context, existing, updates);
          } else {
            await createDataSource(
              organization.id,
              ds.name || k,
              ds.type,
              ds.params,
              ds.settings || {},
              k,
              ds.description
            );
          }
        } catch (e) {
          throw new Error(`Datasource ${k}: ${e.message}`);
        }
      })
    );
  }
  if (config.metrics) {
    await Promise.all(
      Object.keys(config.metrics).map(async (k) => {
        const m = config.metrics?.[k];
        if (!m) return;
        k = k.toLowerCase();

        if (m.datasource) {
          m.datasource = m.datasource.toLowerCase();
        }

        try {
          const existing = await getMetricById(context, k);
          if (existing) {
            const updates: Partial<MetricInterface> = {
              ...m,
            };
            delete updates.organization;

            await updateMetric(context, existing, updates);
          } else {
            await createMetric({
              ...m,
              name: m.name || k,
              id: k,
              organization: organization.id,
            });
          }
          if (m.tags && organization.id) {
            await addTags(organization.id, m.tags);
          }
        } catch (e) {
          throw new Error(`Metric ${k}: ${e.message}`);
        }
      })
    );
  }
  if (config.dimensions) {
    await Promise.all(
      Object.keys(config.dimensions).map(async (k) => {
        const d = config.dimensions?.[k];
        if (!d) return;
        k = k.toLowerCase();

        if (d.datasource) {
          d.datasource = d.datasource.toLowerCase();
        }

        try {
          const existing = await findDimensionById(k, organization.id);
          if (existing) {
            const updates: Partial<DimensionInterface> = {
              ...d,
            };
            delete updates.organization;

            await updateDimension(k, organization.id, updates);
          } else {
            await createDimension({
              ...d,
              id: k,
              dateCreated: new Date(),
              dateUpdated: new Date(),
              organization: organization.id,
            });
          }
        } catch (e) {
          throw new Error(`Dimension ${k}: ${e.message}`);
        }
      })
    );
  }

  if (config.segments) {
    await Promise.all(
      Object.keys(config.segments).map(async (k) => {
        const s = config.segments?.[k];
        if (!s) return;
        k = k.toLowerCase();

        if (s.datasource) {
          s.datasource = s.datasource.toLowerCase();
        }

        try {
          const existing = await findSegmentById(k, organization.id);
          if (existing) {
            const updates: Partial<SegmentInterface> = {
              ...s,
            };
            delete updates.organization;

            await updateSegment(k, organization.id, updates);
          } else {
            await createSegment({
              ...s,
              id: k,
              dateCreated: new Date(),
              dateUpdated: new Date(),
              organization: organization.id,
            });
          }
        } catch (e) {
          throw new Error(`Segment ${k}: ${e.message}`);
        }
      })
    );
  }
}

export async function getEmailFromUserId(userId: string) {
  const u = await UserModel.findOne({ id: userId });
  return u?.email || "";
}

export async function getExperimentOverrides(
  context: ReqContext | ApiReqContext,
  project?: string
) {
  const experiments = await getAllExperiments(context, project);
  const overrides: Record<string, ExperimentOverride> = {};
  const expIdMapping: Record<string, { trackingKey: string }> = {};

  experiments.forEach((exp) => {
    if (exp.archived) {
      return;
    }

    const key = exp.trackingKey || exp.id;
    const groups: string[] = [];

    const phase = exp.phases[exp.phases.length - 1];
    const phaseGroups = (phase as LegacyExperimentPhase)?.groups;
    if (phaseGroups && phaseGroups.length > 0) {
      groups.push(...phaseGroups);
    }

    const override: ExperimentOverride = {
      status: exp.status,
    };

    if (exp.targetURLRegex) {
      override.url = exp.targetURLRegex;
    }

    if (groups.length) {
      override.groups = groups;
    }

    if (phase) {
      override.coverage = phase.coverage;
      override.weights = phase.variationWeights;
    }

    if (exp.status === "stopped") {
      if (exp.results === "won") {
        override.force = exp.winner;
      } else {
        override.force = 0;
      }
    }

    if (exp.status === "running") {
      if (!phase) return;
    }

    overrides[key] = override;
    expIdMapping[exp.id] = { trackingKey: key };
  });

  return { overrides, expIdMapping };
}

export function isEnterpriseSSO(connection?: SSOConnectionInterface) {
  if (!connection) return false;
  // When self-hosting, SSO is always enterprise
  if (!IS_CLOUD) return true;

  // On cloud, the default SSO (Auth0) does not have a connection id
  if (!connection.id) return false;

  return true;
}

// Auto-add user to an organization if using Enterprise SSO
export async function addMemberFromSSOConnection(
  req: AuthRequest
): Promise<OrganizationInterface | null> {
  if (!req.userId) return null;

  const ssoConnection = req.loginMethod;
  if (!ssoConnection || !ssoConnection?.emailDomains?.length) return null;

  // Check if the user's email domain is allowed by the SSO connection
  const emailDomain = req.email.split("@").pop()?.toLowerCase() || "";
  if (!ssoConnection?.emailDomains?.includes(emailDomain)) {
    return null;
  }

  let organization: null | OrganizationInterface = null;
  // On Cloud, we need to get the organization from the SSO connection
  if (IS_CLOUD) {
    if (!ssoConnection.organization) {
      return null;
    }
    organization = await getOrganizationById(ssoConnection.organization);
  }
  // When self-hosting, there should be only one organization in Mongo
  else {
    const { organizations: orgs } = await findAllOrganizations(1, "");
    // Sanity check in case there are multiple orgs for whatever reason
    if (orgs.length > 1) {
      req.log.error(
        "Expected a single organization for self-hosted GrowthBook"
      );
      return null;
    }
    // If this is a brand-new installation, create an organization first
    else if (!orgs.length) {
      organization = await createOrganization({
        email: req.email,
        userId: req.userId,
        name: "My Organization",
      });
      markInstalled();
      return organization;
    }

    organization = orgs[0];
  }
  if (!organization) return null;

  await addMemberToOrg({
    organization,
    userId: req.userId,
    ...getDefaultRole(organization),
  });
  try {
    await sendNewMemberEmail(
      req.name || "",
      req.email || "",
      organization.name,
      organization.ownerEmail
    );
  } catch (e) {
    req.log.error(e, "Failed to send new member email");
  }

  return organization;
}

export async function findVerifiedOrgForNewUser(email: string) {
  const domain = email.toLowerCase().split("@")[1];
  const isFreeDomain = freeEmailDomains.includes(domain);
  if (isFreeDomain) {
    return null;
  }

  const organizations = await findOrganizationsByDomain(domain);
  if (!organizations.length) {
    return null;
  }

  // get the org with the most members
  return organizations.reduce((prev, current) => {
    return prev.members.length > current.members.length ? prev : current;
  });
}

export async function expandOrgMembers(
  members: Member[]
): Promise<ExpandedMember[]> {
  // Add email/name to the organization members array
  const userInfo = await getUsersByIds(members.map((m) => m.id));
  const expandedMembers: ExpandedMember[] = [];
  userInfo.forEach(({ id, email, verified, name, _id }) => {
    const memberInfo = members.find((m) => m.id === id);
    if (!memberInfo) return;
    expandedMembers.push({
      email,
      verified,
      name: name || "",
      ...memberInfo,
      dateCreated: memberInfo.dateCreated || _id.getTimestamp(),
    });
  });
  return expandedMembers;
}

export function getContextForAgendaJobByOrgObject(
  organization: OrganizationInterface
): ApiReqContext {
  return {
    org: organization,
    environments: getEnvironmentIdsFromOrg(organization),
    readAccessFilter: FULL_ACCESS_PERMISSIONS,
    auditUser: null,
  };
}

export async function getContextForAgendaJobByOrgId(
  orgId: string
): Promise<ApiReqContext> {
  const organization = await findOrganizationById(orgId);

  if (!organization) throw new Error("Organization not found");

  return getContextForAgendaJobByOrgObject(organization);
}
