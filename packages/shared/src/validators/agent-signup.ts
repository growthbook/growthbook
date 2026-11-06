import { z } from "zod";
import { sdkLanguages } from "../constants";
import { autoRunMetadata } from "./auto-run";

// Environments a free workspace may have. The sandbox gets production plus the
// one the agent asked for.
export const agentSignupEnvironments = [
  "production",
  "dev",
  "staging",
  "test",
] as const;

export const agentSignupBody = z
  .object({
    language: z
      .enum(sdkLanguages)
      .optional()
      .describe("SDK language of the app. Omit to create no SDK connection."),
    environment: z
      .enum(agentSignupEnvironments)
      .optional()
      .describe("Environment for the SDK connection (default: dev)."),
    name: z
      .string()
      .max(100)
      .optional()
      .describe("The app's name, used for the workspace and the connection."),
    run: z
      .object({
        agent: z
          .string()
          .max(100)
          .optional()
          .describe("The coding agent doing the setup, e.g. claude-code."),
        metadata: autoRunMetadata.optional(),
      })
      .strict()
      .optional()
      .describe("Details for the setup report the sandbox opens."),
  })
  .strict();

export const agentSignupLink = z
  .object({
    code: z.string().describe("The code a person types on the link page."),
    url: z.string(),
    urlWithCode: z.string(),
    expiresAt: z.string(),
  })
  .strict();

export const agentSignupResponse = z
  .object({
    organizationId: z.string(),
    apiKey: z
      .string()
      .describe("A workspace API key with the admin role. Shown once."),
    apiHost: z.string().describe("Where to send REST API calls."),
    sdkConnection: z
      .object({
        id: z.string(),
        clientKey: z.string().describe("Public. Goes in the app's env file."),
        sdkHost: z.string().describe("What the SDK fetches features from."),
        environment: z.string(),
        language: z.string(),
      })
      .strict()
      .nullable(),
    run: z
      .object({
        id: z.string(),
        url: z.string(),
      })
      .strict()
      .describe("The setup report. Record what you create on it."),
    link: agentSignupLink,
    limits: z
      .object({
        plan: z.string(),
        expiresAt: z.string(),
        denied: z
          .array(z.string())
          .describe("Permissions the sandbox lacks until it is linked."),
      })
      .strict(),
    howToUse: z.string(),
  })
  .strict();

export const postAgentSignupValidator = {
  bodySchema: agentSignupBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: agentSignupResponse,
  summary: "Create a sandbox workspace for a coding agent, with no account",
  description:
    "Creates a temporary workspace with an SDK connection, an admin API key that expires with the sandbox, a setup report and a link code. Feature flags work right away. Starting experiments, connecting data sources and webhooks wait until a person links the sandbox at the link URL, which keeps everything the agent made and the same API key. Unlinked sandboxes stop after 7 days.",
  operationId: "postAgentSignup",
  tags: ["agent-signup"],
  method: "post" as const,
  path: "/agent-signup",
  confirmation: [] as const,
  confirmationInHandler: true,
  unauthenticated: true,
  exampleRequest: {
    body: {
      language: "react" as const,
      environment: "dev" as const,
      name: "acme-web",
    },
  },
};

export const agentSignupStatus = z
  .object({
    status: z.enum(["active", "linked", "expired"]),
    expiresAt: z.string(),
    link: z.object({ url: z.string() }).strict(),
    linkedTo: z
      .object({
        organizationId: z.string(),
        mode: z.enum(["new-workspace", "moved"]),
      })
      .strict()
      .nullable(),
    notified: z
      .string()
      .nullable()
      .describe("The address the link email went to, if one was sent."),
  })
  .strict();

export const getAgentSignupStatusValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.object({ sandbox: agentSignupStatus.nullable() }).strict(),
  summary: "Whether this key's workspace is still an unlinked sandbox",
  description:
    "Null when the workspace was never a sandbox. Once linked, the same key keeps working in the linked workspace with full permissions.",
  operationId: "getAgentSignupStatus",
  tags: ["agent-signup"],
  method: "get" as const,
  path: "/agent-signup/status",
};

export const postAgentSignupEmailValidator = {
  bodySchema: z
    .object({
      email: z.email().describe("The person who will own this setup."),
      code: z.string().describe("The link code from signup, as proof."),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.object({ sent: z.boolean(), email: z.string() }).strict(),
  summary: "Email the link code to the person who will own this sandbox",
  description:
    "One email per sandbox. Needs the sandbox's own API key and its link code, so only the agent that created it can send it, and only to one address.",
  operationId: "postAgentSignupEmail",
  tags: ["agent-signup"],
  method: "post" as const,
  path: "/agent-signup/email",
  confirmation: [] as const,
  exampleRequest: { body: { email: "dev@example.com", code: "KQBX-7Q4M" } },
};
