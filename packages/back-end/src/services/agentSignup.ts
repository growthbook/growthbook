import { z } from "zod";
import {
  SANDBOX_LINK_PATH,
  SANDBOX_POLICIES,
  getRolePermissions,
  hasPermission,
} from "shared/permissions";
import {
  agentSignupResponse,
  agentSignupStatus,
  type AutoRunArtifact,
} from "shared/validators";
import {
  OrganizationInterface,
  SandboxConversionCheck,
  SandboxLinked,
} from "shared/types/organization";
import {
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import {
  claimSandboxEmail,
  countOpenSandboxOrganizations,
  createSandboxOrganization,
  findOrganizationById,
  findOrganizationBySandboxCodeHash,
  linkSandboxOrganizationToUser,
  releaseSandboxEmail,
  updateOrganization,
  updateOrganizationSandbox,
} from "back-end/src/models/OrganizationModel";
import {
  createSDKConnection,
  deleteSDKConnectionModel,
  findSDKConnectionById,
  findSDKConnectionsByOrganization,
} from "back-end/src/models/SdkConnectionModel";
import {
  getFeature,
  reassignFeatureOwner,
} from "back-end/src/models/FeatureModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import {
  getBackendFeatureValue,
  trackEventForOrganization,
} from "back-end/src/services/growthbook";
import {
  isEmailEnabled,
  sendSandboxLinkEmail,
} from "back-end/src/services/email";
import { AGENT_OWNER } from "back-end/src/services/owner";
import {
  generateLinkCode,
  hashLinkCode,
  normalizeLinkCode,
  sandboxExpiry,
  sdkHostFor,
} from "back-end/src/util/agentSignup.util";
import {
  AGENT_SIGNUP_ENABLED,
  AGENT_SIGNUP_MAX_OPEN,
  APP_ORIGIN,
  IS_CLOUD,
  IS_MULTI_ORG,
} from "back-end/src/util/secrets";
import { ReqContext } from "back-end/types/request";

export type AgentSignupResponse = z.infer<typeof agentSignupResponse>;
export type AgentSignupStatus = z.infer<typeof agentSignupStatus>;

const POLICY = SANDBOX_POLICIES["agent-signup"];

// Both error paths read `status` off the error, so one class covers the REST
// handler and the app's own routes.
export class AgentSignupError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "AgentSignupError";
  }
}

export function isAgentSignupEnabled(): boolean {
  if (!AGENT_SIGNUP_ENABLED) return false;
  // A single-org instance has nowhere to put a second workspace.
  if (!IS_CLOUD && !IS_MULTI_ORG) return false;
  return getBackendFeatureValue("agent-signup", true);
}

export function sandboxLinkUrl(code?: string): string {
  const url = `${APP_ORIGIN}${SANDBOX_LINK_PATH}`;
  return code ? `${url}?code=${encodeURIComponent(code)}` : url;
}

export async function createAgentSandbox({
  language,
  environment,
  name,
  run,
  apiHost,
}: {
  language?: SDKLanguage;
  environment?: string;
  name?: string;
  run?: {
    agent?: string;
    metadata?: Record<string, string | number | boolean | null>;
  };
  apiHost: string;
}): Promise<AgentSignupResponse> {
  if ((await countOpenSandboxOrganizations()) >= AGENT_SIGNUP_MAX_OPEN) {
    throw new AgentSignupError(
      429,
      `GrowthBook has as many unlinked sandboxes open as it allows. Try again later, or sign up at ${APP_ORIGIN}.`,
    );
  }

  const env = environment ?? "dev";
  const appName = name?.trim() || "Agent setup";
  const code = generateLinkCode();
  const expiresAt = sandboxExpiry(new Date(), POLICY.lifetimeDays);

  // The workspace first; the run and the key are stamped on it once they exist.
  const org = await createSandboxOrganization({
    name: appName,
    environments: [...new Set(["production", env])],
    sandbox: {
      kind: "agent-signup",
      status: "active",
      expiresAt,
      source: { runId: "", apiKeyId: "" },
      codeHash: hashLinkCode(code),
    },
  });
  const context = getContextForAgendaJobByOrgObject(org);

  const project = await context.models.projects.create({
    name: "My First Project",
  });
  const autoRun = await context.models.autoRuns.create({
    source: "cli-wizard",
    agent: run?.agent ?? null,
    createdBy: null,
    metadata: run?.metadata ?? {},
    artifacts: [],
    checks: [],
    outcome: null,
    failureReason: null,
    dateCompleted: null,
  });

  let connection: SDKConnectionInterface | null = null;
  if (language) {
    connection = await createSDKConnection(context, {
      organization: org.id,
      name: `${appName} (${language})`,
      languages: [language],
      environment: env,
      projects: [project.id],
      encryptPayload: false,
      hashSecureAttributes: false,
      includeVisualExperiments: false,
      includeDraftExperiments: false,
      includeExperimentNames: true,
      includeRedirectExperiments: false,
      includeRuleIds: false,
      includeProjectIdInMetadata: false,
      includeCustomFieldsInMetadata: false,
      allowedCustomFieldsInMetadata: [],
      includeTagsInMetadata: false,
    });
    await context.models.autoRuns.appendArtifacts(autoRun.id, [
      {
        kind: "sdk-connection",
        id: connection.id,
        label: connection.name,
        by: "growthbook",
        detail: `${language} · ${env}`,
      },
    ]);
  }

  const apiKey = await context.models.apiKeys.createOrganizationApiKey({
    description: "Agent setup key",
    roleId: "admin",
    expiresAt,
  });
  if (!apiKey.id) throw new Error("The sandbox key was created without an id");
  await updateOrganizationSandbox(org.id, {
    source: { runId: autoRun.id, apiKeyId: apiKey.id },
  });

  trackEventForOrganization(org, "Agent Signup Created", {
    language: language ?? null,
    environment: env,
    agent: run?.agent ?? null,
  });

  const expires = expiresAt.toISOString();
  const runUrl = context.models.autoRuns.toApi(autoRun).url;
  return {
    organizationId: org.id,
    apiKey: apiKey.key,
    apiHost,
    sdkConnection: connection
      ? {
          id: connection.id,
          clientKey: connection.key,
          sdkHost: sdkHostFor(apiHost),
          environment: env,
          language: connection.languages[0],
        }
      : null,
    run: { id: autoRun.id, url: runUrl },
    link: {
      code,
      url: sandboxLinkUrl(),
      urlWithCode: sandboxLinkUrl(code),
      expiresAt: expires,
    },
    limits: {
      plan: "starter",
      expiresAt: expires,
      denied: [...POLICY.deniedPermissions],
    },
    howToUse: [
      "Put sdkConnection.clientKey in the app's env file and point the SDK at sdkConnection.sdkHost.",
      "Create flags and record what you make with apiKey against apiHost; run.url is the setup report.",
      `This is a sandbox: it cannot start experiments, connect data sources or add webhooks until a person links it, and it stops on ${expires}.`,
      "Before you finish, tell your user to link it at link.url with link.code, and repeat both in your last message.",
    ].join(" "),
  };
}

export type SandboxLinkInfo =
  | { status: "invalid" | "not-found" | "used" | "expired" }
  | {
      status: "active";
      sandbox: {
        organizationId: string;
        name: string;
        dateCreated: Date;
        expiresAt: Date;
        agent: string | null;
        artifacts: Pick<AutoRunArtifact, "kind" | "id" | "label" | "by">[];
        runUrl: string;
      };
    };

async function findSandboxByCode(
  rawCode: string,
): Promise<
  | { status: "invalid" | "not-found" | "used" | "expired" }
  | { status: "active"; org: OrganizationInterface; codeHash: string }
> {
  const code = normalizeLinkCode(rawCode);
  if (!code) return { status: "invalid" };
  const codeHash = hashLinkCode(code);
  const org = await findOrganizationBySandboxCodeHash(codeHash);
  if (!org?.sandbox) return { status: "not-found" };
  if (org.sandbox.status === "linked") return { status: "used" };
  if (org.sandbox.status === "expired" || org.sandbox.expiresAt < new Date()) {
    return { status: "expired" };
  }
  return { status: "active", org, codeHash };
}

// What the person sees before they decide: enough to recognise their own
// terminal, and what the agent has made so far, live from the run.
export async function getSandboxLinkInfo(
  rawCode: string,
): Promise<SandboxLinkInfo> {
  const found = await findSandboxByCode(rawCode);
  if (found.status !== "active") return { status: found.status };
  const { org } = found;
  const context = getContextForAgendaJobByOrgObject(org);
  const run = await context.models.autoRuns.getById(
    org.sandbox?.source.runId ?? "",
  );
  return {
    status: "active",
    sandbox: {
      organizationId: org.id,
      name: org.name,
      dateCreated: org.dateCreated,
      expiresAt: org.sandbox?.expiresAt ?? new Date(),
      agent: run?.agent ?? null,
      artifacts: (run?.artifacts ?? []).map(({ kind, id, label, by }) => ({
        kind,
        id,
        label,
        by,
      })),
      runUrl: run ? context.models.autoRuns.toApi(run).url : "",
    },
  };
}

const CODE_PROBLEMS: Record<
  Exclude<SandboxLinkInfo["status"], "active">,
  string
> = {
  invalid: "That is not a link code. It has eight letters, like KQBX-TQWM.",
  "not-found": "No setup matches that code. Check it against your terminal.",
  used: "That code was already used. The setup is linked to whoever used it.",
  expired: "That code has expired. Run the wizard again to start over.",
};

// Linking as a new workspace is one guarded update: the person becomes the
// only member and owner, the code is spent and the sandbox limits lift. The
// agent's key stays and loses its deadline, so its next call just works.
export async function linkSandboxAsNewWorkspace({
  rawCode,
  user,
}: {
  rawCode: string;
  user: { id: string; email: string };
}): Promise<{ organization: OrganizationInterface; runUrl: string }> {
  const found = await findSandboxByCode(rawCode);
  if (found.status !== "active") {
    throw new AgentSignupError(
      found.status === "not-found" ? 404 : 410,
      CODE_PROBLEMS[found.status],
    );
  }
  const linked: SandboxLinked = {
    at: new Date(),
    by: user.id,
    mode: "new-workspace",
    to: { organization: found.org.id, project: null },
    conversion: { ok: false, checks: [] },
  };
  const org = await linkSandboxOrganizationToUser({
    codeHash: found.codeHash,
    userId: user.id,
    email: user.email,
    linked,
  });
  // Lost the race to another tab, or expired a moment ago.
  if (!org?.sandbox) throw new AgentSignupError(410, CODE_PROBLEMS.used);

  const context = getContextForAgendaJobByOrgObject(org);
  await context.models.apiKeys.clearExpiry(org.sandbox.source.apiKeyId);
  await reassignFeatureOwner(context, AGENT_OWNER, user.id);

  const conversion = await verifySandboxConversion(org);
  await updateOrganizationSandbox(org.id, { conversion });
  await context.auditLog({
    event: "organization.update",
    entity: { object: "organization", id: org.id, name: org.name },
    reason: "Linked from an agent sandbox",
    details: JSON.stringify({ linked: { ...linked, conversion } }),
  });

  trackEventForOrganization(org, "Agent Sandbox Linked", {
    mode: linked.mode,
    ok: conversion.ok,
  });
  if (!conversion.ok) {
    trackEventForOrganization(org, "Agent Sandbox Conversion Failed", {
      checks: conversion.checks.filter((c) => !c.ok).map((c) => c.name),
    });
  }

  const run = await context.models.autoRuns.getById(org.sandbox.source.runId);
  return {
    organization: org,
    runUrl: run ? context.models.autoRuns.toApi(run).url : "",
  };
}

async function artifactPresent(
  context: ReqContext,
  org: OrganizationInterface,
  artifact: AutoRunArtifact,
): Promise<boolean | null> {
  switch (artifact.kind) {
    case "feature":
      return !!(await getFeature(context, artifact.id));
    case "experiment":
      return !!(await getExperimentById(context, artifact.id));
    case "sdk-connection":
      return !!(await findSDKConnectionById(context, artifact.id));
    case "attribute":
      return !!org.settings?.attributeSchema?.some(
        (a) => a.property === artifact.id,
      );
    case "environment":
      return !!org.settings?.environments?.some((e) => e.id === artifact.id);
    case "metric":
    case "fact-table":
    case "saved-group":
    case "tag":
      // Not something this check knows how to find; it does not count against the move.
      return null;
  }
}

// A pure comparison of what the run says the agent made against what the
// linked workspace now holds. No side effects, so it can run again from the
// admin page for a support case.
export async function verifySandboxConversion(
  stale: OrganizationInterface,
): Promise<SandboxLinked["conversion"]> {
  const org = (await findOrganizationById(stale.id)) ?? stale;
  const sandbox = org.sandbox;
  if (!sandbox?.linked) {
    return {
      ok: false,
      checks: [
        { name: "Linked", ok: false, required: true, detail: "Not linked yet" },
      ],
    };
  }
  const context = getContextForAgendaJobByOrgObject(org);
  const checks: SandboxConversionCheck[] = [];

  const owner = org.members.find((m) => m.id === sandbox.linked?.by);
  checks.push({
    name: "Owner in place",
    ok: owner?.role === "admin" && !!org.ownerEmail,
    required: true,
    detail: owner
      ? `${org.ownerEmail || "no owner email"} · ${owner.role}`
      : "The linker is not a member",
  });

  const envs = (org.settings?.environments ?? []).map((e) => e.id);
  const permissions = getRolePermissions(
    { role: "admin", limitAccessByEnvironment: false, environments: [] },
    org,
    [],
  );
  checks.push({
    name: "Sandbox limits lifted",
    ok:
      sandbox.status === "linked" &&
      hasPermission(permissions, "runExperiments", "", envs) &&
      hasPermission(permissions, "createDatasources", ""),
    required: true,
    detail: `status ${sandbox.status}`,
  });

  const run = await context.models.autoRuns.getById(sandbox.source.runId);
  const artifacts = run?.artifacts ?? [];
  const missing: string[] = [];
  let checked = 0;
  for (const artifact of artifacts) {
    const present = await artifactPresent(context, org, artifact);
    if (present === null) continue;
    checked++;
    if (!present) missing.push(`${artifact.kind} ${artifact.id}`);
  }
  checks.push({
    name: "Every artifact present",
    ok: missing.length === 0,
    required: true,
    detail: missing.length
      ? `Missing: ${missing.join(", ")}`
      : `${checked} of ${artifacts.length} checked`,
  });

  const connections = await findSDKConnectionsByOrganization(context);
  const recorded = artifacts.filter((a) => a.kind === "sdk-connection");
  checks.push({
    name: "SDK still serves",
    ok: recorded.every((a) =>
      connections.some((c) => c.id === a.id && !!c.key),
    ),
    required: true,
    detail: `${connections.length} connection(s) in the workspace`,
  });

  const key = await context.models.apiKeys.getById(sandbox.source.apiKeyId);
  checks.push({
    name: "Key stays valid",
    ok:
      !!key &&
      key.organization === org.id &&
      !key.disabled &&
      (key.expiresAt ?? null) === null,
    required: true,
    detail: !key
      ? "Key not found"
      : key.disabled
        ? "Key is disabled"
        : key.expiresAt
          ? `Still expires ${key.expiresAt.toISOString()}`
          : "No expiry, enabled",
  });

  return { ok: checks.every((c) => c.ok || !c.required), checks };
}

export function sandboxStatusFor(
  org: OrganizationInterface,
): AgentSignupStatus | null {
  const sandbox = org.sandbox;
  if (!sandbox) return null;
  return {
    status: sandbox.status,
    expiresAt: sandbox.expiresAt.toISOString(),
    link: { url: sandboxLinkUrl() },
    linkedTo: sandbox.linked
      ? {
          organizationId: sandbox.linked.to.organization,
          mode: sandbox.linked.mode,
        }
      : null,
    notified: sandbox.notified?.email ?? null,
  };
}

// The courtesy copy of the code, for the person who is not at the terminal.
// Only the sandbox's own key can send it, it needs the code as proof, and it
// goes once, to one address. Linking still needs a sign-in, so the email on
// its own gets nobody in.
export async function emailSandboxLink(
  context: ReqContext,
  { email, code: rawCode }: { email: string; code: string },
): Promise<{ sent: boolean; email: string }> {
  const org = context.org;
  const sandbox = org.sandbox;
  if (!sandbox || sandbox.status !== "active") {
    throw new AgentSignupError(
      400,
      "This workspace is not an unlinked sandbox.",
    );
  }
  const code = normalizeLinkCode(rawCode);
  if (!code || hashLinkCode(code) !== sandbox.codeHash) {
    throw new AgentSignupError(
      400,
      "That code does not belong to this workspace.",
    );
  }
  if (!isEmailEnabled()) {
    throw new AgentSignupError(
      400,
      "Email is not set up on this GrowthBook instance.",
    );
  }
  if (!(await claimSandboxEmail(org.id, email))) {
    throw new AgentSignupError(
      409,
      `The link was already emailed${sandbox.notified ? ` to ${sandbox.notified.email}` : ""}.`,
    );
  }
  try {
    await sendSandboxLinkEmail({
      email,
      appName: org.name,
      code,
      url: sandboxLinkUrl(code),
      expiresAt: sandbox.expiresAt,
    });
  } catch (e) {
    await releaseSandboxEmail(org.id);
    throw e;
  }
  return { sent: true, email };
}

// An unlinked sandbox past its deadline: the key is already refused, so this
// stops the SDK serving and closes the workspace. Data stays, disabled.
export async function expireSandbox(org: OrganizationInterface): Promise<void> {
  const sandbox = org.sandbox;
  if (!sandbox || sandbox.status !== "active") return;
  const context = getContextForAgendaJobByOrgObject(org);
  if (sandbox.source.apiKeyId) {
    await context.models.apiKeys.setDisabled(sandbox.source.apiKeyId, true);
  }
  for (const connection of await findSDKConnectionsByOrganization(context)) {
    await deleteSDKConnectionModel(context, connection);
  }
  await updateOrganization(org.id, { disabled: true });
  await updateOrganizationSandbox(org.id, {
    status: "expired",
    clearCode: true,
  });
  trackEventForOrganization(org, "Agent Sandbox Expired", {});
}
