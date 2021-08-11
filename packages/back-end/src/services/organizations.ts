import {
  findOrganizationById,
  findOrganizationByInviteKey,
  updateOrganization,
} from "../models/OrganizationModel";
import { randomBytes } from "crypto";
import { APP_ORIGIN } from "../util/secrets";
import { AuthRequest } from "../types/AuthRequest";
import { UserModel } from "../models/UserModel";
import { isEmailEnabled, sendInviteEmail } from "./email";
import {
  MemberRole,
  OrganizationInterface,
  Permissions,
} from "../../types/organization";
import { getExperimentsByOrganization } from "./experiments";
import { ExperimentOverride } from "../../types/api";

export async function getOrganizationById(id: string) {
  return findOrganizationById(id);
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
  userId: string
): MemberRole | null {
  return (
    org.members.filter((m) => m.id === userId).map((m) => m.role)[0] || null
  );
}

export function getPermissionsByRole(role: MemberRole): Permissions {
  const permissions: Permissions = {};
  switch (role) {
    case "admin":
      permissions.organizationSettings = true;
    // falls through
    case "developer":
      permissions.runExperiments = true;
      permissions.createMetrics = true;
    // falls through
    case "designer":
      permissions.draftExperiments = true;
  }
  return permissions;
}

export async function userHasAccess(
  req: AuthRequest,
  organization: string
): Promise<boolean> {
  if (req.admin) return true;
  if (req.organization?.id === organization) return true;

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

export async function acceptInvite(key: string, userId: string) {
  const organization = await findOrganizationByInviteKey(key);
  if (!organization) {
    throw new Error("Invalid key");
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

  let emailSent = false;
  if (isEmailEnabled()) {
    try {
      await sendInviteEmail(organization, key);
      emailSent = true;
    } catch (e) {
      emailSent = false;
    }
  }

  return {
    emailSent,
    inviteUrl: getInviteUrl(key),
  };
}

export async function getEmailFromUserId(userId: string) {
  const u = await UserModel.findOne({ id: userId });
  return u.email;
}

export async function getExperimentOverrides(organization: string) {
  const experiments = await getExperimentsByOrganization(organization);
  const overrides: Record<string, ExperimentOverride> = {};

  experiments.forEach((exp) => {
    if (exp.archived) {
      return;
    }

    const key = exp.trackingKey || exp.id;
    const groups: string[] = [];

    const phase = exp.phases[exp.phases.length - 1];
    if (phase && exp.status === "running" && phase.groups?.length > 0) {
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

    if (exp.status === "stopped" && exp.results === "won") {
      override.force = exp.winner;
    }

    if (exp.status === "running") {
      if (!phase) return;
    }

    overrides[key] = override;
  });

  return overrides;
}
