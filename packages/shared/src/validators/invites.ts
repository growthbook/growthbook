import { z } from "zod";
import { namedSchema } from "./openapi-helpers";
import { apiAdditionalRoles } from "./members";
import {
  DUPLICATE_PROJECT_ROLES_MESSAGE,
  hasNoDuplicateProjects,
} from "./organization";

const apiProjectRoles = z
  .array(
    z.object({
      project: z.string(),
      role: z.string(),
      limitAccessByEnvironment: z.boolean(),
      environments: z.array(z.string()),
      additionalRoles: apiAdditionalRoles,
    }),
  )
  .optional();

const roleInfoFields = {
  role: z.string(),
  limitAccessByEnvironment: z.boolean(),
  environments: z.array(z.string()),
  additionalRoles: apiAdditionalRoles,
  projectRoles: apiProjectRoles,
};

// Same shape as updateMemberRole: an environment list is its own limit.
const roleInput = z
  .object({
    role: z
      .string()
      .optional()
      .describe("Global role. Defaults to the organization's default role."),
    environments: z.array(z.string()).optional(),
    additionalRoles: apiAdditionalRoles,
    projectRoles: z
      .array(
        z.object({
          project: z.string(),
          role: z.string(),
          environments: z.array(z.string()),
          additionalRoles: apiAdditionalRoles,
        }),
      )
      .refine(hasNoDuplicateProjects, {
        message: DUPLICATE_PROJECT_ROLES_MESSAGE,
      })
      .optional(),
  })
  .strict();

export const apiInviteValidator = namedSchema(
  "Invite",
  z
    .object({
      email: z.string(),
      ...roleInfoFields,
      invitedBy: z.string().optional(),
      dateCreated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);

export const apiPendingMemberValidator = namedSchema(
  "PendingMember",
  z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      ...roleInfoFields,
      dateCreated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);

const emailParams = z
  .object({ email: z.string().describe("The invited email address") })
  .strict();

const inviteLinkFields = {
  inviteUrl: z
    .string()
    .describe("Share this link if the email can't be delivered"),
  emailSent: z.boolean(),
};

export const listInvitesValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.object({ invites: z.array(apiInviteValidator) }).strict(),
  summary: "Get all pending invites",
  operationId: "listInvites",
  tags: ["members"],
  method: "get" as const,
  path: "/invites",
};

export const postInviteValidator = {
  bodySchema: roleInput.safeExtend({ email: z.string() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({ invite: apiInviteValidator, ...inviteLinkFields })
    .strict(),
  summary: "Invite a user to the organization",
  description:
    "Inviting an email that already has an invite returns the existing one.",
  operationId: "postInvite",
  tags: ["members"],
  method: "post" as const,
  path: "/invites",
  exampleRequest: {
    body: { email: "new.user@example.com", role: "engineer" },
  },
};

export const putInviteValidator = {
  bodySchema: roleInput,
  querySchema: z.never(),
  paramsSchema: emailParams,
  responseSchema: z.object({ invite: apiInviteValidator }).strict(),
  summary: "Change the role an invite grants",
  operationId: "putInvite",
  tags: ["members"],
  method: "put" as const,
  path: "/invites/:email",
};

export const postInviteResendValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: emailParams,
  responseSchema: z.object(inviteLinkFields).strict(),
  summary: "Resend an invite email",
  operationId: "postInviteResend",
  tags: ["members"],
  method: "post" as const,
  path: "/invites/:email/resend",
};

export const deleteInviteValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: emailParams,
  responseSchema: z.object({ deletedId: z.string() }).strict(),
  summary: "Revoke an invite",
  operationId: "deleteInvite",
  tags: ["members"],
  method: "delete" as const,
  path: "/invites/:email",
};

export const listPendingMembersValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({ pendingMembers: z.array(apiPendingMemberValidator) })
    .strict(),
  summary: "Get users waiting for approval to join",
  operationId: "listPendingMembers",
  tags: ["members"],
  method: "get" as const,
  path: "/pending-members",
};

export const postPendingMemberApproveValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z
    .object({ id: z.string().describe("The pending member's user id") })
    .strict(),
  responseSchema: z.object({ approvedId: z.string() }).strict(),
  summary: "Approve a pending member",
  description:
    "Adds them with the role on their pending request. Use updateMemberRole to change it afterwards.",
  operationId: "postPendingMemberApprove",
  tags: ["members"],
  method: "post" as const,
  path: "/pending-members/:id/approve",
};
