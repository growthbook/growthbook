import mongoose from "mongoose";
import uniqid from "uniqid";
import { cloneDeep } from "lodash";
import { POLICIES, RESERVED_ROLE_IDS } from "shared/permissions";
import { z } from "zod";
import { TeamInterface } from "@back-end/types/team";
import {
  Invite,
  Member,
  MemberRoleWithProjects,
  OrganizationInterface,
  OrganizationMessage,
  Role,
} from "../../types/organization";
import { upgradeOrganizationDoc } from "../util/migrations";
import { ApiOrganization } from "../../types/openapi";
import { IS_CLOUD } from "../util/secrets";
import {
  ToInterface,
  getCollection,
  removeMongooseFields,
} from "../util/mongo.util";

const baseMemberFields = {
  _id: false,
  role: String,
  dateCreated: Date,
  limitAccessByEnvironment: Boolean,
  environments: [String],
  projectRoles: [
    {
      _id: false,
      project: String,
      role: String,
      limitAccessByEnvironment: Boolean,
      environments: [String],
    },
  ],
  teams: [String],
  externalId: String,
  managedByIdp: Boolean,
};

const organizationSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  dateCreated: Date,
  verifiedDomain: String,
  externalId: String,
  url: String,
  name: String,
  ownerEmail: String,
  restrictLoginMethod: String,
  restrictAuthSubPrefix: String,
  autoApproveMembers: Boolean,
  members: [
    {
      ...baseMemberFields,
      id: String,
      lastLoginDate: Date,
    },
  ],
  invites: [
    {
      ...baseMemberFields,
      email: String,
      key: String,
    },
  ],
  pendingMembers: [
    {
      ...baseMemberFields,
      id: String,
      name: String,
      email: String,
    },
  ],
  messages: {
    required: false,
    type: [
      {
        _id: false,
        message: {
          required: true,
          type: String,
        },
        level: {
          required: true,
          type: String,
          enum: ["info", "warning", "danger"],
        },
      },
    ],
  },
  stripeCustomerId: String,
  discountCode: String,
  priceId: String,
  freeSeats: Number,
  disableSelfServeBilling: Boolean,
  freeTrialDate: Date,
  enterprise: Boolean,
  subscription: {
    id: String,
    qty: Number,
    trialEnd: Date,
    status: String,
    current_period_end: Number,
    cancel_at: Number,
    canceled_at: Number,
    cancel_at_period_end: Boolean,
    planNickname: String,
    priceId: String,
    hasPaymentMethod: Boolean,
  },
  licenseKey: String,
  connections: {
    slack: {
      team: String,
      token: String,
    },
    vercel: {
      token: String,
      configurationId: String,
      teamId: String,
    },
  },
  settings: {},
  getStartedChecklistItems: [String],
  customRoles: {},
  deactivatedRoles: [],
  disabled: Boolean,
});

organizationSchema.index({ "members.id": 1 });

const OrganizationModel = mongoose.model<OrganizationInterface>(
  "Organization",
  organizationSchema
);
const COLLECTION = "organizations";

const toInterface: ToInterface<OrganizationInterface> = (doc) =>
  upgradeOrganizationDoc(removeMongooseFields(doc));

export async function createOrganization({
  email,
  userId,
  name,
  url = "",
  verifiedDomain = "",
  externalId = "",
}: {
  email: string;
  userId: string;
  name: string;
  url?: string;
  verifiedDomain?: string;
  externalId?: string;
}) {
  // TODO: sanitize fields
  const doc = await OrganizationModel.create({
    ownerEmail: email,
    name,
    url,
    verifiedDomain,
    externalId,
    invites: [],
    members: [
      {
        id: userId,
        role: "admin",
        dateCreated: new Date(),
        limitAccessByEnvironment: false,
        environments: [],
      },
    ],
    id: uniqid("org_"),
    dateCreated: new Date(),
    settings: {
      environments: [
        {
          id: "production",
          description: "",
          toggleOnList: true,
          defaultState: true,
        },
      ],
      // Default to the same attributes as the auto-wrapper for the Javascript SDK
      attributeSchema: [
        { property: "id", datatype: "string", hashAttribute: true },
        { property: "url", datatype: "string" },
        { property: "path", datatype: "string" },
        { property: "host", datatype: "string" },
        { property: "query", datatype: "string" },
        { property: "deviceType", datatype: "enum", enum: "desktop,mobile" },
        {
          property: "browser",
          datatype: "enum",
          enum: "chrome,edge,firefox,safari,unknown",
        },
        { property: "utmSource", datatype: "string" },
        { property: "utmMedium", datatype: "string" },
        { property: "utmCampaign", datatype: "string" },
        { property: "utmTerm", datatype: "string" },
        { property: "utmContent", datatype: "string" },
      ],
    },
    getStartedChecklistItems: [],
  });
  return toInterface(doc);
}

export async function findAllOrganizations(
  page: number,
  search: string,
  limit: number = 50
) {
  const regex = new RegExp(search, "i");

  const query = search
    ? {
        $or: [
          { name: regex },
          { ownerEmail: regex },
          { id: regex },
          { externalId: regex },
          { verifiedDomain: regex },
        ],
      }
    : {};

  const docs = await OrganizationModel.find(query)
    .sort({ _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  const total = await (search
    ? OrganizationModel.find(query).countDocuments()
    : OrganizationModel.find().estimatedDocumentCount());

  return { organizations: docs.map(toInterface), total };
}

export async function findOrganizationById(id: string) {
  const doc = await getCollection(COLLECTION).findOne({ id });
  return doc ? toInterface(doc) : null;
}

export async function updateOrganization(
  id: string,
  update: Partial<OrganizationInterface>
) {
  await OrganizationModel.updateOne(
    {
      id,
    },
    {
      $set: update,
    }
  );
}

export async function updateOrganizationByStripeId(
  stripeCustomerId: string,
  update: Partial<OrganizationInterface>
) {
  await OrganizationModel.updateOne(
    {
      stripeCustomerId,
    },
    {
      $set: update,
    }
  );
}

export async function findOrganizationByStripeCustomerId(id: string) {
  const doc = await OrganizationModel.findOne({
    stripeCustomerId: id,
  });

  return doc ? toInterface(doc) : null;
}

export async function getAllInviteEmailsInDb() {
  if (IS_CLOUD) {
    throw new Error("getAllInviteEmailsInDb() is not supported on cloud");
  }

  const organizations = await OrganizationModel.find(
    {},
    { "invites.email": 1 }
  );

  const inviteEmails: string[] = organizations.reduce(
    (emails: string[], organization) => {
      const orgEmails = organization.invites.map((invite) => invite.email);
      return emails.concat(orgEmails);
    },
    []
  );

  return inviteEmails;
}

export async function getSelfHostedOrganization() {
  if (IS_CLOUD) {
    throw new Error("getSelfHostedOrganization() is not supported on cloud");
  }

  const doc = await OrganizationModel.findOne();
  return doc ? toInterface(doc) : null;
}

export async function hasOrganization() {
  const res = await getCollection(COLLECTION).findOne();
  return !!res;
}

export async function findOrganizationsByMemberId(userId: string) {
  const docs = await getCollection(COLLECTION)
    .find({
      members: {
        $elemMatch: {
          id: userId,
        },
      },
      disabled: { $ne: true },
    })
    .toArray();
  return docs.map(toInterface);
}

export async function findOrganizationsByMemberIds(userId: string[]) {
  const docs = await getCollection(COLLECTION)
    .find({
      members: {
        $elemMatch: {
          id: { $in: userId },
        },
      },
      disabled: { $ne: true },
    })
    .toArray();
  return docs.map(toInterface);
}

export async function findOrganizationByInviteKey(key: string) {
  const doc = await OrganizationModel.findOne({
    "invites.key": key,
    disabled: { $ne: true },
  });
  return doc ? toInterface(doc) : null;
}

export async function getOrganizationFromSlackTeam(teamId: string) {
  const organization = await OrganizationModel.findOne({
    "connections.slack.team": teamId,
  });
  if (!organization) {
    throw new Error("Unknown slack team id");
  }

  return toInterface(organization);
}

export async function getOrganizationsWithNorthStars() {
  const withNorthStars = await OrganizationModel.find({
    "settings.northStar.metricIds": {
      $exists: true,
      $ne: [],
    },
  });
  return withNorthStars.map(toInterface);
}

export async function removeProjectFromProjectRoles(
  project: string,
  org: OrganizationInterface
) {
  if (!org) return;

  const updates: {
    members?: Member[];
    invites?: Invite[];
  } = {};

  const members = cloneDeep(org.members);
  members.forEach((m) => {
    if (!m.projectRoles?.length) return;
    m.projectRoles = m.projectRoles.filter((pr) => pr.project !== project);
  });
  if (JSON.stringify(members) !== JSON.stringify(org.members)) {
    updates["members"] = members;
  }

  const invites = cloneDeep(org.invites);
  invites.forEach((inv) => {
    if (!inv.projectRoles?.length) return;
    inv.projectRoles = inv.projectRoles.filter((pr) => pr.project !== project);
  });
  if (JSON.stringify(invites) !== JSON.stringify(org.invites)) {
    updates["invites"] = invites;
  }

  if (Object.keys(updates).length > 0) {
    await OrganizationModel.updateOne({ id: org.id }, { $set: updates });
  }
}

export async function findOrganizationsByDomain(domain: string) {
  const docs = await OrganizationModel.find({
    verifiedDomain: domain,
    disabled: { $ne: true },
  });
  return docs.map(toInterface);
}

export async function setOrganizationMessages(
  orgId: string,
  messages: OrganizationMessage[]
): Promise<void> {
  await OrganizationModel.updateOne(
    {
      id: orgId,
    },
    { messages },
    {
      runValidators: true,
    }
  );
}

export function toOrganizationApiInterface(
  org: OrganizationInterface
): ApiOrganization {
  const { id, externalId, name, ownerEmail, dateCreated } = org;
  return {
    id,
    externalId,
    name,
    ownerEmail,
    dateCreated: dateCreated?.toISOString() || "",
  };
}

export async function updateMember(
  org: OrganizationInterface,
  userId: string,
  updates: Partial<Member>
) {
  if (updates.id) throw new Error("Cannot update member id");

  const member = org.members.find((m) => m.id === userId);

  if (!member) throw new Error("Member not found");

  await updateOrganization(org.id, {
    members: org.members.map((m) => {
      if (m.id === userId) {
        return {
          ...m,
          ...updates,
        };
      }
      return m;
    }),
  });
}

export const customRoleValidator = z
  .object({
    id: z.string().min(2).max(64),
    description: z.string().max(100),
    policies: z.array(z.enum(POLICIES)),
  })
  .strict();

export async function addCustomRole(org: OrganizationInterface, role: Role) {
  // Basic Validation
  role = customRoleValidator.parse(role);

  // Make sure role id is not reserved
  if (RESERVED_ROLE_IDS.includes(role.id)) {
    throw new Error("That role id is reserved and cannot be used");
  }

  // Make sure role id is not already in use
  if (org.customRoles?.find((r) => r.id === role.id)) {
    throw new Error("That role id already exists");
  }

  // Validate custom role id format
  if (!/^[a-zA-Z0-9_]+$/.test(role.id)) {
    throw new Error(
      "Role id must only include letters, numbers, and underscores."
    );
  }

  const customRoles = [...(org.customRoles || [])];
  customRoles.push(role);

  await updateOrganization(org.id, { customRoles });
}

export async function editCustomRole(
  org: OrganizationInterface,
  id: string,
  updates: Omit<Role, "id">
) {
  // Validation
  updates = customRoleValidator.omit({ id: true }).parse(updates);

  let found = false;
  const newCustomRoles = (org.customRoles || []).map((role) => {
    if (role.id === id) {
      found = true;
      return {
        ...role,
        ...updates,
      };
    }
    return role;
  });

  if (!found) {
    throw new Error("Role not found");
  }

  await updateOrganization(org.id, { customRoles: newCustomRoles });
}

function usingRole(member: MemberRoleWithProjects, role: string): boolean {
  return (
    member.role === role ||
    (member.projectRoles || []).some((pr) => pr.role === role)
  );
}

export async function removeCustomRole(
  org: OrganizationInterface,
  teams: TeamInterface[],
  id: string
) {
  // Make sure the id isn't the org's default
  if (org.settings?.defaultRole?.role === id) {
    throw new Error(
      "Cannot delete role. This role is set as the organization's default role."
    );
  }
  // Make sure no members, invites, pending members, or teams are using the role
  if (org.members.some((m) => usingRole(m, id))) {
    throw new Error("Role is currently being used by at least one member");
  }
  if (org.pendingMembers?.some((m) => usingRole(m, id))) {
    throw new Error(
      "Role is currently being used by at least one pending member"
    );
  }
  if (org.invites?.some((m) => usingRole(m, id))) {
    throw new Error(
      "Role is currently being used by at least one invited member"
    );
  }
  if (teams.some((team) => usingRole(team, id))) {
    throw new Error("Role is currently being used by at least one team");
  }

  const newCustomRoles = (org.customRoles || []).filter(
    (role) => role.id !== id
  );

  if (newCustomRoles.length === (org.customRoles || []).length) {
    throw new Error("Role not found");
  }

  const updates: Partial<OrganizationInterface> = {
    customRoles: newCustomRoles,
  };

  if (org.deactivatedRoles?.includes(id)) {
    updates.deactivatedRoles = org.deactivatedRoles.filter((r) => r !== id);
  }

  await updateOrganization(org.id, updates);
}

export async function deactivateRoleById(
  org: OrganizationInterface,
  id: string
) {
  if (
    !RESERVED_ROLE_IDS.includes(id) &&
    !org.customRoles?.some((role) => role.id === id)
  ) {
    throw new Error(`Unable to find role id ${id}`);
  }

  const deactivatedRoles = new Set<string>(org.deactivatedRoles);
  deactivatedRoles.add(id);

  await updateOrganization(org.id, {
    deactivatedRoles: Array.from(deactivatedRoles),
  });
}

export async function activateRoleById(org: OrganizationInterface, id: string) {
  if (!org.deactivatedRoles || !org.deactivatedRoles?.includes(id)) {
    throw new Error("Cannot activate a role that isn't deactivated");
  }

  const newDeactivatedRoles = org.deactivatedRoles.filter(
    (role) => role !== id
  );

  await updateOrganization(org.id, { deactivatedRoles: newDeactivatedRoles });
}

export async function addGetStartedChecklistItem(id: string, item: string) {
  await OrganizationModel.updateOne(
    {
      id,
    },
    {
      $addToSet: { getStartedChecklistItems: item },
    }
  );
}
