import {
  createOrganization,
  findAllOrganizations,
  findOrganizationById,
  findOrganizationByInviteKey,
  updateOrganization,
} from "../models/OrganizationModel";
import { randomBytes } from "crypto";
import { APP_ORIGIN, IS_CLOUD } from "../util/secrets";
import { AuthRequest } from "../types/AuthRequest";
import { UserModel } from "../models/UserModel";
import { isEmailEnabled, sendInviteEmail, sendNewMemberEmail } from "./email";
import {
  MemberRole,
  OrganizationInterface,
  Permissions,
} from "../../types/organization";
import { createMetric, getExperimentsByOrganization } from "./experiments";
import { ExperimentOverride } from "../../types/api";
import { ConfigFile } from "../init/config";
import {
  createDataSource,
  getDataSourceById,
  updateDataSource,
} from "../models/DataSourceModel";
import {
  encryptParams,
  getSourceIntegrationObject,
  mergeParams,
} from "./datasource";
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
import { updateSubscriptionInStripe } from "./stripe";
import { markInstalled } from "./auth";
import { SSOConnectionInterface } from "../../types/sso-connection";

export async function getOrganizationById(id: string) {
  return findOrganizationById(id);
}

export function getOrgFromReq(req: AuthRequest) {
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
    environments: getEnvironments(req.organization),
    userName: req.name || "",
  };
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

// Handle old roles in a backwards-compatible way
export function updateRole(role: MemberRole): MemberRole {
  if (role === "designer") {
    return "collaborator";
  }
  if (role === "developer") {
    return "experimenter";
  }
  return role;
}

export function getRole(
  org: OrganizationInterface,
  userId: string
): MemberRole {
  return updateRole(
    org.members.filter((m) => m.id === userId).map((m) => m.role)[0] ||
      "readonly"
  );
}

export function getDefaultPermissions(): Permissions {
  return {
    addComments: false,
    createIdeas: false,
    createPresentations: false,
    publishFeatures: false,
    createFeatures: false,
    createFeatureDrafts: false,
    createAnalyses: false,
    createDimensions: false,
    createMetrics: false,
    createSegments: false,
    runQueries: false,
    editDatasourceSettings: false,
    createDatasources: false,
    organizationSettings: false,
    superDelete: false,
  };
}

export function getPermissionsByRole(role: MemberRole): Permissions {
  role = updateRole(role);

  // Start with no permissions
  const permissions = getDefaultPermissions();

  // Base permissions shared by everyone (except readonly)
  if (role !== "readonly") {
    permissions.addComments = true;
    permissions.createIdeas = true;
    permissions.createPresentations = true;
  }

  // Feature flag permissions
  if (role === "engineer" || role === "experimenter" || role === "admin") {
    permissions.publishFeatures = true;
    permissions.createFeatures = true;
    permissions.createFeatureDrafts = true;
  }

  // Analysis permissions
  if (role === "analyst" || role === "experimenter" || role === "admin") {
    permissions.createAnalyses = true;
    permissions.createDimensions = true;
    permissions.createMetrics = true;
    permissions.createSegments = true;
    permissions.runQueries = true;
    permissions.editDatasourceSettings = true;
  }

  // Admin permissions
  if (role === "admin") {
    permissions.organizationSettings = true;
    permissions.createDatasources = true;
    permissions.superDelete = true;
  }

  return permissions;
}

export function getNumberOfMembersAndInvites(
  organization: OrganizationInterface
) {
  return organization.members.length + (organization.invites?.length || 0);
}

export async function userHasAccess(
  req: AuthRequest,
  organization: string
): Promise<boolean> {
  if (req.admin) return true;
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

  if (!members.length) {
    throw new Error("Organizations must have at least 1 member");
  }

  await updateOrganization(organization.id, {
    members,
  });

  // Update Stripe subscription if org has subscription
  if (organization.subscription?.id) {
    // Get the updated organization
    const updatedOrganization = await getOrganizationById(organization.id);

    if (updatedOrganization?.subscription) {
      await updateSubscriptionInStripe(
        updatedOrganization.subscription.id,
        getNumberOfMembersAndInvites(updatedOrganization)
      );
    }
  }

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

  // Update Stripe subscription if org has subscription
  if (organization.subscription?.id) {
    // Get the updated organization
    const updatedOrganization = await getOrganizationById(organization.id);

    if (updatedOrganization?.subscription) {
      await updateSubscriptionInStripe(
        updatedOrganization.subscription.id,
        getNumberOfMembersAndInvites(updatedOrganization)
      );
    }
  }

  return organization;
}

export function getInviteUrl(key: string) {
  return `${APP_ORIGIN}/invitation?key=${key}`;
}

export async function addMemberToOrg(
  org: OrganizationInterface,
  userId: string,
  role: MemberRole = "collaborator"
) {
  // If memebr is already in the org, skip
  if (org.members.find((m) => m.id === userId)) {
    return;
  }

  const members = [
    ...org.members,
    {
      id: userId,
      role,
    },
  ];

  await updateOrganization(org.id, { members });

  // Update Stripe subscription if org has subscription
  if (org.subscription?.id) {
    // Get the updated organization
    const updatedOrganization = await getOrganizationById(org.id);

    if (updatedOrganization?.subscription) {
      await updateSubscriptionInStripe(
        updatedOrganization.subscription.id,
        getNumberOfMembersAndInvites(updatedOrganization)
      );
    }
  }
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

  // Remove invite
  const invites = organization.invites.filter((invite) => invite.key !== key);

  // Add to member list
  const members = [
    ...organization.members,
    {
      id: userId,
      role: invite?.role || "admin",
    },
  ];

  await updateOrganization(organization.id, {
    invites,
    members,
  });

  return organization;
}

export async function inviteUser(
  organization: OrganizationInterface,
  email: string,
  role: MemberRole = "admin"
) {
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
  const invites = [
    ...organization.invites,
    {
      email,
      key,
      dateCreated: new Date(),
      role,
    },
  ];

  await updateOrganization(organization.id, {
    invites,
  });

  // append the new invites to the existin object (or refetch)
  organization.invites = invites;

  // Update Stripe subscription if org has subscription
  if (organization.subscription?.id) {
    await updateSubscriptionInStripe(
      organization.subscription.id,
      getNumberOfMembersAndInvites(organization)
    );
  }

  let emailSent = false;
  if (isEmailEnabled()) {
    try {
      await sendInviteEmail(organization, key);
      emailSent = true;
    } catch (e) {
      console.error("Error sending email: " + e);
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
  config: ConfigFile,
  organization: OrganizationInterface
) {
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
          const existing = await getDataSourceById(k, organization.id);
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

            await updateDataSource(k, organization.id, updates);
          } else {
            await createDataSource(
              organization.id,
              ds.name || k,
              ds.type,
              ds.params,
              ds.settings || {},
              k
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
          const existing = await getMetricById(k, organization.id);
          if (existing) {
            const updates: Partial<MetricInterface> = {
              ...m,
            };
            delete updates.organization;

            await updateMetric(k, updates, organization.id);
          } else {
            await createMetric({
              ...m,
              name: m.name || k,
              id: k,
              organization: organization.id,
            });
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
}

export async function getEmailFromUserId(userId: string) {
  const u = await UserModel.findOne({ id: userId });
  return u?.email || "";
}

export async function getExperimentOverrides(
  organization: string,
  project?: string
) {
  const experiments = await getExperimentsByOrganization(organization, project);
  const overrides: Record<string, ExperimentOverride> = {};
  const expIdMapping: Record<string, { trackingKey: string }> = {};

  experiments.forEach((exp) => {
    if (exp.archived) {
      return;
    }

    const key = exp.trackingKey || exp.id;
    const groups: string[] = [];

    const phase = exp.phases[exp.phases.length - 1];
    if (phase && phase.groups && phase.groups.length > 0) {
      groups.push(...phase.groups);
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
  if (!ssoConnection || !ssoConnection.emailDomain) return null;

  // Check if the user's email domain is allowed by the SSO connection
  const emailDomain = req.email.split("@").pop()?.toLowerCase() || "";
  if (emailDomain !== ssoConnection.emailDomain) {
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
    const orgs = await findAllOrganizations();
    // Sanity check in case there are multiple orgs for whatever reason
    if (orgs.length > 1) {
      console.error(
        "Expected a single organization for self-hosted GrowthBook"
      );
      return null;
    }
    // If this is a brand-new installation, create an organization first
    else if (!orgs.length) {
      organization = await createOrganization(
        req.email,
        req.userId,
        "My Organization",
        ""
      );
      markInstalled();
      return organization;
    }

    organization = orgs[0];
  }
  if (!organization) return null;

  await addMemberToOrg(organization, req.userId);
  try {
    await sendNewMemberEmail(
      req.name || "",
      req.email || "",
      organization.name,
      organization.ownerEmail
    );
  } catch (e) {
    console.error("Failed to send new member email", e.message);
  }

  return organization;
}
