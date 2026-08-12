import { randomBytes } from "crypto";
import { z } from "zod";
import { freeEmailDomains } from "free-email-domains-typescript";
import { cloneDeep } from "lodash";
import { Request } from "express";
import {
  areProjectRolesValid,
  isRoleValid,
  getDefaultRole,
} from "shared/permissions";
import {
  DEFAULT_CONFIDENCE_LEVEL,
  DEFAULT_MAX_PERCENT_CHANGE,
  DEFAULT_METRIC_CAPPING,
  DEFAULT_METRIC_CAPPING_VALUE,
  DEFAULT_METRIC_WINDOW,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_METRIC_WINDOW_HOURS,
  DEFAULT_MIN_PERCENT_CHANGE,
  DEFAULT_MIN_SAMPLE_SIZE,
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_TARGET_MDE,
} from "shared/constants";
import {
  AIModel,
  AIModelKind,
  AIProvider,
  AI_PROVIDERS,
  CLOUD_MANAGED_AI_MODEL,
  CLOUD_MANAGED_IMAGE_MODEL,
  CLOUD_MANAGED_VISUAL_EDITOR_AI_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  EmbeddingModel,
  getProviderForAIModel,
} from "shared/ai";
import { SSOConnectionInterface } from "shared/types/sso-connection";
import {
  MetricCappingSettings,
  MetricPriorSettings,
  MetricWindowSettings,
} from "shared/types/fact-table";
import {
  ExpandedMember,
  ExpandedMemberInfo,
  Invite,
  Member,
  MemberRoleInfo,
  MemberRoleWithProjects,
  MetricDefaults,
  OrganizationInterface,
  PendingMember,
  ProjectMemberRole,
} from "shared/types/organization";
import { MetricInterface } from "shared/types/metric";
import { DimensionInterface } from "shared/types/dimension";
import { DataSourceInterface } from "shared/types/datasource";
import { LegacyExperimentPhase } from "shared/types/experiment";
import { PValueCorrection } from "shared/types/stats";
import { getScopedSettings } from "shared/settings";
import {
  acceptOrganizationInvite,
  addOrganizationInviteIfSeatAvailable,
  addOrganizationMemberIfSeatAvailable,
  createOrganization,
  findAllOrganizations,
  findOrganizationById,
  findOrganizationByInviteKey,
  findOrganizationsByDomain,
  updateOrganization,
} from "back-end/src/models/OrganizationModel";
import {
  APP_ORIGIN,
  GEMINI_IMAGE_MODEL,
  IS_CLOUD,
  IS_MULTI_ORG,
} from "back-end/src/util/secrets";
import {
  AIKeySource,
  canOrgChooseProviderModels,
  getResolvedAIKeys,
} from "back-end/src/services/aiCredentials";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext, ExperimentOverride } from "back-end/types/api";
import { ConfigFile } from "back-end/src/init/config";
import {
  createDataSource,
  getDataSourceById,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import {
  ALLOWED_METRIC_TYPES,
  getMetricById,
  updateMetric,
} from "back-end/src/models/MetricModel";
import {
  createDimension,
  findDimensionById,
  updateDimension,
} from "back-end/src/models/DimensionModel";
import { logger } from "back-end/src/util/logger";
import { PaymentRequiredError } from "back-end/src/util/errors";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { addTags } from "back-end/src/models/TagModel";
import { getUserById, getUsersByIds } from "back-end/src/models/UserModel";
import {
  getLicenseMetaData,
  getUserCodesForOrg,
} from "back-end/src/services/licenseData";
import {
  getAccountPlan,
  getLicense,
  licenseInit,
} from "back-end/src/enterprise";
import { getEffectiveOrgLimits } from "back-end/src/services/plan-limits";
import { TeamModel } from "back-end/src/models/TeamModel";
import { findVercelInstallationByInstallationId } from "back-end/src/models/VercelNativeIntegrationModel";
import {
  encryptParams,
  getSourceIntegrationObject,
  mergeParams,
} from "./datasource";
import { createMetric } from "./experiments";
import {
  isEmailEnabled,
  sendInviteEmail,
  sendNewMemberEmail,
  sendPendingMemberEmail,
} from "./email";
import { ReqContextClass } from "./context";

export {
  getEnvironments,
  getEnvironmentIdsFromOrg,
} from "back-end/src/util/organization.util";

export async function getOrganizationById(id: string) {
  return findOrganizationById(id);
}

export async function setLicenseKey(
  org: OrganizationInterface,
  licenseKey: string,
) {
  if (!IS_CLOUD && IS_MULTI_ORG) {
    throw new Error(
      "You must use the LICENSE_KEY environmental variable on multi org sites.",
    );
  }

  org.licenseKey = licenseKey;
  await licenseInit(org, getUserCodesForOrg, getLicenseMetaData, true);
}

export function validateLoginMethod(
  org: OrganizationInterface,
  req: AuthRequest,
) {
  if (
    org.restrictLoginMethod &&
    req.loginMethod?.id !== org.restrictLoginMethod &&
    !req.superAdmin
  ) {
    throw new Error(
      `Your organization requires you to login with ${
        org.restrictLoginMethod.startsWith("vercel:")
          ? "Vercel"
          : "Enterprise SSO"
      }`,
    );
  }

  if (req.loginMethod?.id?.startsWith("vercel:")) {
    const installationId = req.loginMethod.id.split(":")[1];
    if (installationId !== req.vercelInstallationId) {
      throw new Error(`Vercel installation id mismatch`);
    }
  }

  // If the org requires a specific subject in the IdToken
  // This is mostly used with GrowthBook Cloud to restrict people to "Login with Google"
  // For that, we set `restrictAuthSubPrefix` to "google"
  if (
    org.restrictAuthSubPrefix &&
    !req.authSubject?.startsWith(org.restrictAuthSubPrefix) &&
    !req.superAdmin
  ) {
    throw new Error(
      `Your organization requires you to login with ${org.restrictAuthSubPrefix}`,
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

  return new ReqContextClass({
    org: req.organization,
    auditUser: {
      type: "dashboard",
      id: req.userId,
      email: req.email,
      name: req.name || "",
    },
    user: {
      id: req.userId,
      email: req.email,
      name: req.name || "",
      superAdmin: req.superAdmin,
    },
    teams: req.teams,
    req: req as Request,
  });
}

async function resolveScopedSettingsForProject(
  context: ReqContext,
  projectId: string | undefined,
) {
  const project =
    projectId && projectId.length > 0
      ? (await context.getProjects()).find((p) => p.id === projectId)
      : undefined;
  return getScopedSettings({
    organization: context.org,
    project,
  });
}

function confidenceLevelsFromScopedSettings(
  settings: ReturnType<typeof getScopedSettings>["settings"],
) {
  const ciUpper = settings.confidenceLevel.value || DEFAULT_CONFIDENCE_LEVEL;
  return {
    ciUpper,
    ciLower: 1 - ciUpper,
    ciUpperDisplay: Math.round(ciUpper * 100) + "%",
    ciLowerDisplay: Math.round((1 - ciUpper) * 100) + "%",
  };
}

export async function getConfidenceLevelsForProject(
  context: ReqContext,
  projectId: string | undefined,
) {
  const { settings } = await resolveScopedSettingsForProject(
    context,
    projectId,
  );
  return confidenceLevelsFromScopedSettings(settings);
}

/**
 * Resolves all significance-related settings (confidence levels, p-value
 * threshold, p-value correction) with a single call.
 */
export async function getSignificanceSettingsForProject(
  context: ReqContext,
  projectId: string | undefined,
): Promise<{
  ciUpper: number;
  ciLower: number;
  ciUpperDisplay: string;
  ciLowerDisplay: string;
  pValueThreshold: number;
  pValueCorrection: PValueCorrection;
}> {
  const { settings } = await resolveScopedSettingsForProject(
    context,
    projectId,
  );
  return {
    ...confidenceLevelsFromScopedSettings(settings),
    pValueThreshold:
      settings.pValueThreshold.value ?? DEFAULT_P_VALUE_THRESHOLD,
    pValueCorrection: settings.pValueCorrection.value ?? null,
  };
}

export async function getAISettingsForOrg(
  context: ReqContext,
  includeKey: boolean = false,
): Promise<{
  aiEnabled: boolean;
  openAIAPIKey: string;
  anthropicAPIKey: string;
  xaiAPIKey: string;
  mistralAPIKey: string;
  googleAPIKey: string;
  // Where each provider's key came from. Non-secret, so returned regardless of
  // `includeKey`.
  keySource: Record<AIProvider, AIKeySource>;
  defaultAIModel: AIModel;
  embeddingModel: EmbeddingModel;
  // Resolved Visual Editor overrides — both already fall back to a
  // sensible default so callers don't need their own resolution logic.
  visualEditorAIModel: AIModel;
  visualEditorImageModel: string;
  // Free-text brand guidelines appended to the AI system prompt.
  visualEditorAIContext: string;
}> {
  // Cloud: a stored key beats the env var. Self-hosted: the env var wins.
  // Either way it only counts while the plan allows it — see getResolvedAIKeys.
  // Memoized per request, so repeated calls cost one query.
  const resolvedKeys = await getResolvedAIKeys(context);

  const keySource = AI_PROVIDERS.reduce(
    (acc, provider) => {
      acc[provider] = resolvedKeys[provider].source;
      return acc;
    },
    {} as Record<AIProvider, AIKeySource>,
  );

  const hasValidKey = AI_PROVIDERS.some((p) => !!resolvedKeys[p].key);

  // Cloud ships with GrowthBook's own managed keys, so AI only needs the org
  // toggle. Self-hosted additionally needs a key from somewhere.
  const aiEnabled = IS_CLOUD
    ? !!context.org.settings?.aiEnabled
    : !!(context.org.settings?.aiEnabled && hasValidKey);

  // Cloud pins the cheap managed model because GrowthBook pays for it; an org on
  // its own key for that model's provider picks its own.
  const orgDefaultAIModel = getAllowedAIModel(
    "text",
    context.org.settings?.defaultAIModel ||
      context.org.settings?.openAIDefaultModel,
    keySource,
  );
  const defaultAIModel: AIModel =
    orgDefaultAIModel || (IS_CLOUD ? CLOUD_MANAGED_AI_MODEL : "gpt-5.4-mini");

  // Cloud stays on Sonnet unless the Visual Editor's own setting overrides it:
  // its structured-output + vision workload fails schema adherence on Haiku.
  const visualEditorAIModel: AIModel =
    getAllowedAIModel(
      "text",
      context.org.settings?.visualEditorAIModel,
      keySource,
    ) || (IS_CLOUD ? CLOUD_MANAGED_VISUAL_EDITOR_AI_MODEL : defaultAIModel);
  // Managed Cloud gets Gemini 3 Pro Image for aspect-ratio fidelity. An org on
  // its own Google key gets the stable default, since a preview model isn't
  // enabled on every account.
  const visualEditorImageModel: string =
    getAllowedAIModel(
      "image",
      context.org.settings?.visualEditorImageModel,
      keySource,
    ) ||
    (IS_CLOUD && !canOrgChooseProviderModels(keySource, "google")
      ? CLOUD_MANAGED_IMAGE_MODEL
      : GEMINI_IMAGE_MODEL);

  return {
    aiEnabled,
    openAIAPIKey: includeKey ? resolvedKeys.openai.key : "",
    anthropicAPIKey: includeKey ? resolvedKeys.anthropic.key : "",
    xaiAPIKey: includeKey ? resolvedKeys.xai.key : "",
    mistralAPIKey: includeKey ? resolvedKeys.mistral.key : "",
    googleAPIKey: includeKey ? resolvedKeys.google.key : "",
    keySource,
    defaultAIModel,
    embeddingModel:
      getAllowedAIModel(
        "embedding",
        context.org.settings?.embeddingModel,
        keySource,
      ) || DEFAULT_EMBEDDING_MODEL,
    visualEditorAIModel,
    visualEditorImageModel,
    visualEditorAIContext: (
      context.org.settings?.visualEditorAIContext || ""
    ).trim(),
  };
}

// Stored and request-level model choices use the same runtime entitlement rule.
// A disallowed legacy value reads as unset so callers fall back safely.
export function getAllowedAIModel<T extends string>(
  kind: AIModelKind,
  model: T | undefined,
  keySource: Record<AIProvider, AIKeySource>,
): T | undefined {
  if (!model) return undefined;
  const provider = getProviderForAIModel(kind, model);
  return provider && canOrgChooseProviderModels(keySource, provider)
    ? model
    : undefined;
}

export function getMetricDefaultsForOrg(context: ReqContext): MetricDefaults {
  const defaultMetricWindowSettings: MetricWindowSettings = {
    type: DEFAULT_METRIC_WINDOW,
    windowValue: DEFAULT_METRIC_WINDOW_HOURS,
    windowUnit: "hours",
    delayValue: DEFAULT_METRIC_WINDOW_DELAY_HOURS,
    delayUnit: "hours",
  };
  const defaultMetricCappingSettings: MetricCappingSettings = {
    type: DEFAULT_METRIC_CAPPING,
    value: DEFAULT_METRIC_CAPPING_VALUE,
  };
  const defaultMetricPriorSettings: MetricPriorSettings = {
    override: false,
    proper: false,
    mean: 0,
    stddev: DEFAULT_PROPER_PRIOR_STDDEV,
  };

  const METRIC_DEFAULTS = {
    minimumSampleSize: DEFAULT_MIN_SAMPLE_SIZE,
    maxPercentageChange: DEFAULT_MAX_PERCENT_CHANGE,
    minPercentageChange: DEFAULT_MIN_PERCENT_CHANGE,
    targetMDE: DEFAULT_TARGET_MDE,
    windowSettings: defaultMetricWindowSettings,
    cappingSettings: defaultMetricCappingSettings,
    priorSettings: defaultMetricPriorSettings,
  };

  return context.org.settings?.metricDefaults || METRIC_DEFAULTS;
}

export async function getPValueThresholdForProject(
  context: ReqContext,
  // undefined project means fall back to org setting
  projectId: string | undefined,
): Promise<number> {
  const { settings } = await resolveScopedSettingsForProject(
    context,
    projectId,
  );
  return settings.pValueThreshold.value ?? DEFAULT_P_VALUE_THRESHOLD;
}

export async function getPValueCorrectionForProject(
  context: ReqContext,
  // undefined project means fall back to org setting
  projectId: string | undefined,
): Promise<PValueCorrection> {
  const { settings } = await resolveScopedSettingsForProject(
    context,
    projectId,
  );
  return settings.pValueCorrection.value ?? null;
}

export function getRole(
  org: OrganizationInterface,
  userId: string,
  project?: string,
): MemberRoleInfo {
  const member = org.members.find((m) => m.id === userId);

  if (member) {
    // Project-specific role
    if (project && member.projectRoles) {
      const projectRole = member.projectRoles.find(
        (r) => r.project === project,
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
  organization: OrganizationInterface,
) {
  // There was a bug that allowed duplicate members in the members array
  const numMembers = new Set(organization.members.map((m) => m.id)).size;
  const numInvites = new Set(organization.invites.map((i) => i.email)).size;

  return numMembers + numInvites;
}

type OrganizationSeatLimit = {
  maxSeats: number;
  error: () => Error;
};

async function getOrganizationSeatLimit(
  organization: OrganizationInterface,
): Promise<OrganizationSeatLimit | null> {
  const license =
    getLicense(organization.licenseKey) ||
    (await licenseInit(organization, getUserCodesForOrg, getLicenseMetaData));

  const hardCapLimit: OrganizationSeatLimit | null = license?.hardCap
    ? {
        maxSeats: license.seats || 0,
        error: () =>
          new Error(
            "Whoops! You've reached the seat limit on your license. Please contact sales@growthbook.io to increase your seat limit.",
          ),
      }
    : null;
  const starterLimit: OrganizationSeatLimit | null =
    IS_CLOUD && getAccountPlan(organization) === "starter"
      ? {
          maxSeats: organization.freeSeats ?? 3,
          error: () =>
            new PaymentRequiredError(
              "You've reached the free seat limit. Upgrade your plan to add more team members.",
            ),
        }
      : null;

  if (!hardCapLimit) return starterLimit;
  if (!starterLimit) return hardCapLimit;
  return hardCapLimit.maxSeats <= starterLimit.maxSeats
    ? hardCapLimit
    : starterLimit;
}

export async function removeMember(
  organization: OrganizationInterface,
  id: string,
) {
  const members = organization.members.filter((member) => member.id !== id);
  const pendingMembers = (organization?.pendingMembers || []).filter(
    (member) => member.id !== id,
  );

  if (!members.length) {
    throw new Error("Organizations must have at least 1 member");
  }

  await updateOrganization(organization.id, {
    members,
    pendingMembers,
  });

  const updatedOrganization = cloneDeep(organization);
  updatedOrganization.members = members;
  updatedOrganization.pendingMembers = pendingMembers;

  await licenseInit(
    updatedOrganization,
    getUserCodesForOrg,
    getLicenseMetaData,
    true,
  );

  return updatedOrganization;
}

export async function revokeInvite(
  organization: OrganizationInterface,
  key: string,
) {
  const invites = organization.invites.filter((invite) => invite.key !== key);

  await updateOrganization(organization.id, {
    invites,
  });

  const updatedOrganization = cloneDeep(organization);
  updatedOrganization.invites = invites;
  await licenseInit(
    updatedOrganization,
    getUserCodesForOrg,
    getLicenseMetaData,
    true,
  );

  return updatedOrganization;
}

export function getInviteUrl(key: string) {
  return `${APP_ORIGIN}/invitation?key=${key}`;
}

// Free (role-restricted) plans can only assign the admin global role. Only the
// global role is checked here.
export function assertRoleAssignmentAllowed(
  organization: OrganizationInterface,
  role: string,
) {
  if (getEffectiveOrgLimits(organization).orgSupportsRoles()) return;
  if (role === "admin") return;

  throw new PaymentRequiredError(
    "Your plan only supports the admin role. Upgrade your plan to assign other roles.",
  );
}

// Gate a human role selection but only when the role actually changes, so
// existing assignments keep working.
export function assertRoleChangeAllowed(
  organization: OrganizationInterface,
  existingRole: string,
  newRole: string,
) {
  if (existingRole === newRole) return;
  assertRoleAssignmentAllowed(organization, newRole);
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
  teams = [],
}: {
  organization: OrganizationInterface;
  userId: string;
  role: string;
  limitAccessByEnvironment: boolean;
  environments: string[];
  projectRoles?: ProjectMemberRole[];
  externalId?: string;
  managedByIdp?: boolean;
  teams?: string[];
}) {
  // If member is already in the org, skip
  if (organization.members.find((m) => m.id === userId)) {
    return;
  }

  // Ensure roles are valid
  if (
    !isRoleValid(role, organization) ||
    !areProjectRolesValid(projectRoles, organization)
  ) {
    throw new Error("Invalid role");
  }

  // Role limits are gated where a human picks a role; automated joins keep
  // the configured default so they never throw or escalate to admin.

  const member: Member = {
    id: userId,
    role,
    limitAccessByEnvironment,
    environments,
    projectRoles,
    dateCreated: new Date(),
    externalId,
    managedByIdp,
    teams,
  };
  const seatLimit = await getOrganizationSeatLimit(organization);
  const updatedOrganization = await addOrganizationMemberIfSeatAvailable(
    organization.id,
    member,
    seatLimit?.maxSeats ?? null,
  );

  if (!updatedOrganization) {
    const latestOrganization = await findOrganizationById(organization.id);
    if (!latestOrganization) {
      throw new Error("Unable to locate organization");
    }
    if (latestOrganization.members.some((existing) => existing.id === userId)) {
      return;
    }
    if (seatLimit) {
      throw seatLimit.error();
    }
    throw new Error("Unable to add organization member");
  }

  await licenseInit(
    updatedOrganization,
    getUserCodesForOrg,
    getLicenseMetaData,
    true,
  );
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

export function getMembersOfTeam(org: OrganizationInterface, teamId: string) {
  return org.members
    .filter((member) => member.teams?.includes(teamId))
    .map((m) => m.id);
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
      "Tried to update a member that does not exist in the organization",
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
  // Also update the organization reference in-memory so the team can be deleted if it's now empty
  organization.members = updatedMembers;
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
  role: string;
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

  // Ensure roles are valid
  if (
    !isRoleValid(role, organization) ||
    !areProjectRolesValid(projectRoles, organization)
  ) {
    throw new Error("Invalid role");
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

export async function acceptInvite(key: string, userId: string, email: string) {
  const organization = await findOrganizationByInviteKey(key);
  if (!organization) {
    throw new Error("Invalid key");
  }

  // If member is already in the org, skip so they don't get added to organization.members a second time causing duplicates.
  if (organization.members.find((m) => m.id === userId)) {
    throw new Error(
      "Whoops! You're already a user, you can't accept a new invitation.",
    );
  }

  const invite = organization.invites.filter((invite) => invite.key === key)[0];
  if (!invite) {
    throw new Error("Could not find invitation with that key");
  }

  // Ensure the invite was issued to the authenticated user's email; otherwise a
  // leaked invite key would let any logged-in user join with the invited role.
  if (!email || email.toLowerCase() !== invite.email.toLowerCase()) {
    throw new Error("This invitation was sent to a different email address");
  }

  const updatedOrganization = await acceptOrganizationInvite(
    organization.id,
    key,
    {
      id: userId,
      role: invite.role || "admin",
      limitAccessByEnvironment: !!invite.limitAccessByEnvironment,
      environments: invite.environments || [],
      projectRoles: invite.projectRoles,
      teams: invite.teams,
      dateCreated: new Date(),
    },
  );

  if (!updatedOrganization) {
    const latestOrganization = await findOrganizationById(organization.id);
    if (!latestOrganization) {
      throw new Error("Unable to locate organization");
    }
    if (latestOrganization.members.some((member) => member.id === userId)) {
      throw new Error(
        "Whoops! You're already a user, you can't accept a new invitation.",
      );
    }
    if (!latestOrganization.invites.some((existing) => existing.key === key)) {
      throw new Error("Could not find invitation with that key");
    }
    throw new Error("Unable to accept organization invitation");
  }

  return updatedOrganization;
}

export async function inviteUser({
  organization,
  email,
  role = "admin",
  limitAccessByEnvironment,
  environments,
  projectRoles,
  invitedBy,
}: {
  organization: OrganizationInterface;
  email: string;
  invitedBy?: string;
} & MemberRoleWithProjects) {
  organization.invites = organization.invites || [];

  email = email.trim().toLowerCase();

  // Reject malformed addresses (e.g. a stray trailing ";" from a pasted
  // Outlook-style list). Mail servers silently strip such separators, so the
  // email would be delivered, but accepting the invite would then fail because
  // the stored email would never match the recipient's real address.
  if (!z.string().email().safeParse(email).success) {
    throw new Error(`Invalid email address: ${email}`);
  }

  // User is already invited (legacy invites may have been stored with
  // mixed case, so compare case-insensitively).
  const existingInvite = organization.invites.find(
    (invite) => invite.email.toLowerCase() === email,
  );
  if (existingInvite) {
    return {
      emailSent: true,
      inviteUrl: getInviteUrl(existingInvite.key),
    };
  }

  // Ensure roles are valid
  if (
    !isRoleValid(role, organization) ||
    !areProjectRolesValid(projectRoles, organization)
  ) {
    throw new Error("Invalid role");
  }
  assertRoleAssignmentAllowed(organization, role);
  const seatLimit = await getOrganizationSeatLimit(organization);

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

  const invite: Invite = {
    email,
    key,
    dateCreated: new Date(),
    role,
    limitAccessByEnvironment,
    environments,
    projectRoles,
    invitedBy,
  };
  const updatedOrganization = await addOrganizationInviteIfSeatAvailable(
    organization.id,
    invite,
    seatLimit?.maxSeats ?? null,
  );

  if (!updatedOrganization) {
    const latestOrganization = await findOrganizationById(organization.id);
    if (!latestOrganization) {
      throw new Error("Unable to locate organization");
    }
    const latestInvite = latestOrganization.invites.find(
      (existing) => existing.email.toLowerCase() === email,
    );
    if (latestInvite) {
      return {
        emailSent: true,
        inviteUrl: getInviteUrl(latestInvite.key),
      };
    }
    if (seatLimit) {
      throw seatLimit.error();
    }
    throw new Error("Unable to add organization invite");
  }

  await licenseInit(
    updatedOrganization,
    getUserCodesForOrg,
    getLicenseMetaData,
    true,
  );

  let emailSent = false;
  if (isEmailEnabled()) {
    try {
      await sendInviteEmail(updatedOrganization, key);
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
      "Invalid id (must be only alphanumeric plus underscores and hyphens)",
    );
  }
}

function validateConfig(context: ReqContext, config: ConfigFile) {
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
        getSourceIntegrationObject(context, {
          ...props,
          params: encryptParams(params),
          id: k,
          organization: context.org.id,
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
            "Unknown datasource id '" + dimension.datasource + "'",
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
  config: ConfigFile,
) {
  const organization = context.org;
  const errors = validateConfig(context, config);
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
              const integration = getSourceIntegrationObject(context, existing);
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
              context,
              ds.name || k,
              ds.type,
              ds.params,
              ds.settings || {},
              k,
              ds.description,
            );
          }
        } catch (e) {
          throw new Error(`Datasource ${k}: ${e.message}`);
        }
      }),
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
            await createMetric(context, {
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
      }),
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
            await updateDimension(context, existing, updates);
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
      }),
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
          const existing = await context.models.segments.getById(k);
          if (existing) {
            await context.models.segments.update(existing, s);
          } else {
            await context.models.segments.create({
              ...s,
              id: k,
            });
          }
        } catch (e) {
          throw new Error(`Segment ${k}: ${e.message}`);
        }
      }),
    );
  }
}

export async function getExperimentOverrides(
  context: ReqContext | ApiReqContext,
  project?: string,
) {
  const experiments = await getAllExperiments(context, { project });
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

  // Vercel SSO connections are not enterprise
  if (connection.id.startsWith("vercel:")) return false;

  return true;
}

// Auto-add user to an organization if using Enterprise SSO
export async function addMemberFromSSOConnection(
  req: AuthRequest,
): Promise<OrganizationInterface | null> {
  if (!req.userId) return null;

  const ssoConnection = req.loginMethod;
  if (!ssoConnection) return null;

  // For non-vercel, require email domains to match
  if (!ssoConnection.id?.startsWith("vercel:")) {
    if (!ssoConnection?.emailDomains?.length) return null;

    // Check if the user's email domain is allowed by the SSO connection
    const emailDomain = req.email.split("@").pop()?.toLowerCase() || "";
    if (!ssoConnection?.emailDomains?.includes(emailDomain)) {
      return null;
    }
  }

  let organization: null | OrganizationInterface = null;
  // On Cloud, we need to get the organization from the SSO connection
  if (IS_CLOUD) {
    // For Vercel, we need to look up the Vercel installation to find the org
    if (ssoConnection.id?.startsWith("vercel:")) {
      const installationId = ssoConnection.id.split(":")[1];
      if (!installationId) return null;
      if (installationId !== req.vercelInstallationId) return null;

      const installation =
        await findVercelInstallationByInstallationId(installationId);
      if (!installation) {
        return null;
      }
      organization = await findOrganizationById(installation.organization);
    } else {
      if (!ssoConnection.organization) {
        return null;
      }
      organization = await getOrganizationById(ssoConnection.organization);
    }
  }
  // When self-hosting, there should be only one organization in Mongo
  else {
    const { organizations: orgs } = await findAllOrganizations(1, "");
    // Sanity check in case there are multiple orgs for whatever reason
    if (orgs.length > 1) {
      req.log.error(
        "Expected a single organization for self-hosted GrowthBook",
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
      return organization;
    }

    organization = orgs[0];
  }
  if (!organization) return null;

  // If the org has explicitly disabled autoApproveMembers, add the user as a pending member
  // This differs from the non-SSO path (`undefined` is auto-approved there) to preserve existing behavior
  if (organization.autoApproveMembers === false) {
    const alreadyPending = organization.pendingMembers?.some(
      (m) => m.id === req.userId,
    );
    if (!alreadyPending) {
      await addPendingMemberToOrg({
        organization,
        name: req.name || "",
        email: req.email || "",
        userId: req.userId,
        ...getDefaultRole(organization),
      });
      try {
        const teamUrl = APP_ORIGIN + "/settings/team/?org=" + organization.id;
        await sendPendingMemberEmail(
          req.name || "",
          req.email || "",
          organization.name,
          organization.ownerEmail,
          teamUrl,
        );
      } catch (e) {
        req.log.error(e, "Failed to send pending member email");
      }
    }
    return null;
  }

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
      organization.ownerEmail,
    );
  } catch (e) {
    req.log.error(e, "Failed to send new member email");
  }

  return organization;
}

export async function findVerifiedOrgsForNewUser(email: string) {
  const domain = email.toLowerCase().split("@")[1];
  const isFreeDomain = freeEmailDomains.includes(domain);
  if (isFreeDomain) {
    return null;
  }

  const organizations = await findOrganizationsByDomain(domain);
  if (!organizations.length) {
    return null;
  }

  if (IS_CLOUD) {
    // On cloud, return an array with only the single org with the most members, as the others are probably just "test" accounts.
    return [
      organizations.reduce((prev, current) => {
        return prev.members.length > current.members.length ? prev : current;
      }),
    ];
  } else {
    // On multi-org self hosted sites, all orgs with the domain should be available to users to join not just the one with the most members
    return organizations;
  }
}

const expandedMemberInfoCache: Record<
  string,
  ExpandedMemberInfo & {
    dateCreated?: Date;
    e: number;
  }
> = {};
const EXPANDED_MEMBER_CACHE_TTL = 1000 * 60 * 15; // 15 minutes

// Add email/name to the organization members array
export async function expandOrgMembers(
  members: Member[],
  currentUserId?: string,
): Promise<ExpandedMember[]> {
  const expandedMembers: ExpandedMember[] = [];

  // First look in cache
  const now = Date.now();
  const remainingMembers: Member[] = [];
  members.forEach((m) => {
    const cache = expandedMemberInfoCache[m.id];
    if (cache && cache.e > now && m.id !== currentUserId) {
      expandedMembers.push({
        email: cache.email,
        verified: cache.verified,
        name: cache.name || "",
        ...m,
        dateCreated: m.dateCreated || cache.dateCreated,
      });
    } else {
      remainingMembers.push(m);
    }
  });

  if (remainingMembers.length > 0) {
    const userInfo = await getUsersByIds(remainingMembers.map((m) => m.id));
    userInfo.forEach(({ id, email, verified, name, dateCreated }) => {
      const memberInfo = remainingMembers.find((m) => m.id === id);
      if (!memberInfo) return;
      expandedMembers.push({
        email,
        verified,
        name: name || "",
        ...memberInfo,
        dateCreated: memberInfo.dateCreated || dateCreated,
      });

      expandedMemberInfoCache[id] = {
        email,
        verified,
        name: name || "",
        dateCreated: dateCreated,
        e:
          now +
          EXPANDED_MEMBER_CACHE_TTL +
          // Random jitter to avoid cache stampedes
          Math.floor(Math.random() * EXPANDED_MEMBER_CACHE_TTL * 0.1),
      };
    });
  }

  return expandedMembers;
}

export function getContextForAgendaJobByOrgObject(
  organization: OrganizationInterface,
): ApiReqContext {
  return new ReqContextClass({
    org: organization,
    auditUser: null,
    // TODO: Limit background job permissions to the user who created the job
    role: "admin",
  });
}

export async function getContextForAgendaJobByOrgId(
  orgId: string,
): Promise<ApiReqContext> {
  const organization = await findOrganizationById(orgId);

  if (!organization) throw new Error("Organization not found");

  if (organization.licenseKey && !getLicense(organization.licenseKey)) {
    await licenseInit(organization, getUserCodesForOrg, getLicenseMetaData);
  }

  return getContextForAgendaJobByOrgObject(organization);
}

export async function getContextForUserIdInOrg(
  org: OrganizationInterface,
  userId: string,
): Promise<ApiReqContext | null> {
  const user = await getUserById(userId);
  if (!user) return null;

  const isMember = org.members.some((m) => m.id === user.id);
  if (!isMember) return null;

  const teams = await TeamModel.dangerousGetTeamsForOrganization(org.id);

  return new ReqContextClass({
    org,
    auditUser: {
      type: "dashboard",
      id: user.id,
      email: user.email,
      name: user.name || "",
    },
    user: {
      id: user.id,
      email: user.email,
      name: user.name || "",
      superAdmin: user.superAdmin,
    },
    teams,
  });
}
