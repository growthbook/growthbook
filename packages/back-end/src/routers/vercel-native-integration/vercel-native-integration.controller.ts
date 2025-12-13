import crypto from "crypto";
import { Request, Response } from "express";
import { z } from "zod";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { v4 as uuidv4 } from "uuid";
import { generateProjectPublicIdFromName } from "shared/util";
import { ManagedBy } from "shared/validators";
import {
  findVercelInstallationByInstallationId,
  VercelNativeIntegrationModel,
  Resource,
  VercelNativeIntegration,
} from "back-end/src/models/VercelNativeIntegrationModel";
import {
  addMemberToOrg,
  getOrganizationById,
} from "back-end/src/services/organizations";
import {
  createOrganization,
  updateOrganization,
  findOrganizationById,
} from "back-end/src/models/OrganizationModel";
import { createUser, getUserByEmail } from "back-end/src/models/UserModel";
import { ReqContextClass } from "back-end/src/services/context";
import { OrganizationInterface } from "back-end/types/organization";
import { ReqContext } from "back-end/types/request";
import {
  getVercelSSOToken,
  syncVercelSdkConnection,
  deleteVercelSdkWebhook,
} from "back-end/src/services/vercel-native-integration.service";
import {
  createSDKConnection,
  updateSdkConnectionsRemoveManagedBy,
} from "back-end/src/models/SdkConnectionModel";
import { IdTokenCookie, SSOConnectionIdCookie } from "back-end/src/util/cookie";
import {
  getUserLoginPropertiesFromRequest,
  trackLoginForUser,
} from "back-end/src/services/users";
import {
  postCancelSubscriptionToLicenseServer,
  postNewVercelSubscriptionToLicenseServer,
} from "back-end/src/enterprise";
import { getLicenseByKey } from "back-end/src/enterprise/models/licenseModel";
import {
  userAuthenticationValidator,
  systemAuthenticationValidator,
  UpsertInstallationPayload,
  ProvisitionResource,
  UpdateResource,
  UpdateInstallation,
  BillingPlan,
} from "./vercel-native-integration.validators";

const STARTER_BILLING_PLAN: BillingPlan = {
  description: "Basic flags and experiments for solo devs and small teams",
  id: "starter-billing-plan",
  name: "Starter Plan",
  cost: "Free",
  type: "subscription",
  details: [
    { label: "Feature Flags & Evaluations", value: "Unlimited" },
    { label: "Experiments", value: "Unlimited" },
    { label: "Seats", value: "Up to 3" },
  ],
};

function getProBillingPlan(perSeatCost: number): BillingPlan {
  const id =
    perSeatCost === 20 ? "pro-billing-plan" : `pro-billing-plan-${perSeatCost}`;
  return {
    description: "Full featured experimentation and growth platform",
    id,
    name: "Pro Plan",
    type: "subscription",
    cost: `Starting at $${perSeatCost}/month`,
    details: [
      { label: "Feature Flags & Evaluations", value: "Unlimited" },
      { label: "Experiments", value: "Unlimited" },
      { label: "Seats", value: `$${perSeatCost}/seat/month` },
      {
        label: "Advanced Flags",
        value: "Safe Rollouts, pre-requisites, & more",
      },
      {
        label: "Advanced Experimentation",
        value: "Bandits, advanced metrics, & more",
      },
    ],
  };
}

const allBillingPlans = [
  STARTER_BILLING_PLAN,
  getProBillingPlan(20),
  getProBillingPlan(40),
] as const;

// Some plan IDs are legacy and should not be shown in the UI
const availableBillingPlans = [
  STARTER_BILLING_PLAN,
  getProBillingPlan(40),
] as const;

const VERCEL_JKWS_URL = "https://marketplace.vercel.com/.well-known/jwks";

const vercelJKWSKey = createRemoteJWKSet(new URL(VERCEL_JKWS_URL));

const getBearerToken = (req: Request) => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
      return parts[1];
    }
  }

  return undefined;
};

type CheckedAuth<T extends string | "user"> = T extends "user"
  ? {
      status: "authenticated";
      authentication: z.infer<typeof userAuthenticationValidator>;
    }
  : {
      status: "authenticated";
      authentication: z.infer<typeof systemAuthenticationValidator>;
    };

const checkAuth = async <T extends string | "user">({
  token,
  type,
}: {
  token: string;
  type: T;
}): Promise<CheckedAuth<T> | { status: "error"; message: string }> => {
  try {
    const payload = await jwtVerify(token, await vercelJKWSKey);

    if (type === "user")
      return {
        status: "authenticated",
        authentication: userAuthenticationValidator.parse(payload),
      } as CheckedAuth<T>;

    if (type === "system")
      return {
        status: "authenticated",
        authentication: systemAuthenticationValidator.parse(payload),
      } as CheckedAuth<T>;

    return { status: "error", message: `Unsupported authentication: ${type}` };
  } catch (_err) {
    return { status: "error", message: "Invalid credentials" };
  }
};

const getOrgFromInstallationResource = async <T>(
  installationId: string,
  resourceId?: T,
): Promise<{
  org: OrganizationInterface;
  integration: VercelNativeIntegration;
  resource: T extends string ? Resource : undefined;
}> => {
  const integration =
    await findVercelInstallationByInstallationId(installationId);

  if (!integration) throw new Error("Invalid installation!");

  const resource = (() => {
    if (!resourceId) return;

    return integration.resources.find(({ id }) => id === resourceId);
  })();

  if (resourceId && !resource) {
    throw new Error(`Invalid resourceId: ${resourceId}`);
  }

  const org = await findOrganizationById(integration.organization);

  if (!org) throw new Error("Invalid installation!");

  return {
    org,
    integration,
    resource: resource as T extends string ? Resource : undefined,
  };
};

const getContext = async ({
  installationId,
  resourceId,
  userEmail,
  res,
}: {
  installationId: string;
  resourceId?: string;
  userEmail?: string;
  res: Response;
}) => {
  const failed = (status: number, reason?: string) => {
    if (reason) res.status(status).send(reason);
    else res.sendStatus(status);

    throw new Error("Authentication failed");
  };

  const { org, integration, resource } = await (async () => {
    try {
      return await getOrgFromInstallationResource(installationId, resourceId);
    } catch (err) {
      return failed(401, err.message);
    }
  })();

  const user = userEmail ? await getUserByEmail(userEmail) : undefined;

  if (userEmail && !user) failed(400, "Invalid user!");

  // TODO: Verify the token is for an admin user (or system)
  const context = new ReqContextClass({
    org,
    auditUser: user
      ? {
          type: "dashboard",
          id: user.id,
          email: user.email,
          name: user.name || user.email,
        }
      : null,
    role: "admin",
  });

  const integrationModel = new VercelNativeIntegrationModel(context);

  return {
    context,
    org,
    user,
    integrationModel,
    integration,
    resource,
  };
};

const authContext = async (req: Request, res: Response) => {
  const failed = (status: number, reason?: string) => {
    if (reason) res.status(status).send(reason);
    else res.sendStatus(status);

    throw new Error("Authentication failed");
  };

  const token = getBearerToken(req);

  if (!token) return failed(401, "Invalid credentials");

  const checkedAuth = await checkAuth({
    token,
    type: String(req.headers["x-vercel-auth"]),
  });

  if (checkedAuth.status === "error") return failed(401, checkedAuth.message);

  const {
    authentication: {
      payload: { installation_id: installationId },
    },
  } = checkedAuth;

  if (
    req.params.installation_id &&
    installationId !== req.params.installation_id
  )
    return failed(400, "Invalid request!");

  return getContext({
    installationId,
    resourceId: req.params.resource_id,
    userEmail:
      "user_email" in checkedAuth.authentication.payload &&
      typeof checkedAuth.authentication.payload.user_email === "string"
        ? checkedAuth.authentication.payload.user_email
        : undefined,
    res,
  });
};

const findOrCreateUser = async (email: string, name?: string) => {
  const existingUser = await getUserByEmail(email);

  if (existingUser) return existingUser;

  return createUser({
    name: name || email.split("@")[0],
    email,
    password: crypto.randomBytes(18).toString("hex"),
  });
};

export async function upsertInstallation(req: Request, res: Response) {
  const token = getBearerToken(req);

  if (!token) return res.status(401).send("Invalid credentials");

  const checkedAuth = await checkAuth({ token, type: "user" });

  if (checkedAuth.status === "error")
    return res.status(401).send(checkedAuth.message);

  const { authentication } = checkedAuth;

  const payload = req.body as UpsertInstallationPayload;

  if (authentication.payload.installation_id !== req.params.installation_id)
    return res.status(400).send("Invalid request!");

  const user = await findOrCreateUser(
    payload.account.contact.email,
    payload.account.name,
  );

  const org = await createOrganization({
    email: payload.account.contact.email,
    userId: user.id,
    name:
      payload.account.name ||
      `Vercel installation ${authentication.payload.installation_id}`,
    isVercelIntegration: true,
    restrictLoginMethod: `vercel:${req.params.installation_id}`,
  });

  const context = new ReqContextClass({
    org,
    auditUser: null,
    user,
  });

  const integrationModel = new VercelNativeIntegrationModel(context);

  await integrationModel.create({
    installationId: authentication.payload.installation_id,
    upsertData: { payload, authentication: authentication.payload },
    resources: [],
  });

  return res.sendStatus(204);
}

export async function getInstallation(req: Request, res: Response) {
  const { integration } = await authContext(req, res);

  // billingPlan is not initially set.
  const billingPlan = allBillingPlans.find(
    ({ id }) => id === integration.billingPlanId,
  );

  return res.json({ billingPlan });
}

export async function updateInstallation(req: Request, res: Response) {
  const { integration, integrationModel, org, user } = await authContext(
    req,
    res,
  );

  const { billingPlanId } = req.body as UpdateInstallation;

  const billingPlan = allBillingPlans.find(({ id }) => id === billingPlanId);

  if (!billingPlan) return res.status(400).send("Invalid billing plan!");

  // Check if current billing plan is different from new plan
  if (integration.billingPlanId !== billingPlanId) {
    if (billingPlanId?.startsWith("pro-billing-plan")) {
      // The user is upgrading from the starter plan to the pro plan
      try {
        const result = await postNewVercelSubscriptionToLicenseServer(
          org,
          req.params.installation_id,
          user?.name || "",
        );
        await updateOrganization(org.id, { licenseKey: result.id });
      } catch (e) {
        throw new Error(
          `Unable to create new subscription. Reason: ${e.message} || "Unknown`,
        );
      }
    } else {
      // The user is downgrading from the pro plan to the starter plan
      try {
        const license = await getLicenseByKey(org.licenseKey || "");

        if (!license) {
          return res
            .status(404)
            .send(`Unable to locate license for org: ${org.id}`);
        }
        await postCancelSubscriptionToLicenseServer(license.id);
      } catch (e) {
        throw new Error(
          `Unable to cancel subscription. Reason: ${e.message} || "Unknown`,
        );
      }
    }
  }

  await integrationModel.update(integration, { billingPlanId });

  return res.send({ billingPlan });
}

export async function deleteInstallation(req: Request, res: Response) {
  const { context, integrationModel, integration, org } = await authContext(
    req,
    res,
  );

  if (integration.billingPlanId?.startsWith("pro-billing-plan")) {
    const license = await getLicenseByKey(org.licenseKey || "");

    if (!license) {
      return res.status(404).send(`Invalid license for org: ${org.id}`);
    }

    await postCancelSubscriptionToLicenseServer(license.id);
  }

  await removeManagedBy(context, { type: "vercel" });
  await integrationModel.deleteById(integration.id);

  await updateOrganization(
    org.id,
    {
      isVercelIntegration: false,
    },
    { restrictLoginMethod: 1 },
  );

  //MKTODO: Remove the finalized: true before we ship this to production
  return res.status(200).send({ finalized: true });
}

export async function provisionResource(req: Request, res: Response) {
  const { user, org, context, integrationModel, integration } =
    await authContext(req, res);

  const {
    externalId: _externalId,
    billingPlanId,
    ...payload
  } = req.body as ProvisitionResource;

  const billingPlan = allBillingPlans.find(({ id }) => id === billingPlanId);

  if (!billingPlan) return res.status(400).send("Invalid billing plan!");

  if (!integration.billingPlanId) {
    // The installation doesn't have a billing plan yet, so we need to create a new one
    if (billingPlanId?.startsWith("pro-billing-plan")) {
      try {
        // Get fresh org with updated name
        const updatedOrg = await getOrganizationById(org.id);

        if (!updatedOrg) {
          throw new Error("Organization not found");
        }
        const result = await postNewVercelSubscriptionToLicenseServer(
          updatedOrg,
          req.params.installation_id,
          user?.name || "",
        );
        await updateOrganization(org.id, { licenseKey: result.id });
      } catch (e) {
        throw new Error(
          `Unable to create new subscription. Reason: ${e.message} || "Unknown`,
        );
      }
    }

    // Then, update the integration with the new billing plan
    await integrationModel.update(integration, {
      billingPlanId,
    });
  }

  const resourceId = uuidv4();

  const managedBy = {
    type: "vercel",
    resourceId,
  } as const;

  const basePublicId =
    generateProjectPublicIdFromName(payload.name) || "project";
  const project = await context.models.projects.create({
    name: payload.name,
    publicId: basePublicId,
    managedBy,
  });

  const sdkConnection = await createSDKConnection({
    organization: org.id,
    name: payload.name,
    languages: ["nextjs"],
    environment: "production",
    includeVisualExperiments: true,
    includeDraftExperiments: true,
    includeRuleIds: true,
    includeRedirectExperiments: false,
    includeExperimentNames: true,
    includeProjectPublicId: false,
    hashSecureAttributes: false,
    projects: [project.id],
    encryptPayload: false,
    managedBy,
  });

  const resource: Resource = {
    ...payload,
    id: resourceId,
    secrets: [{ name: "GROWTHBOOK_CLIENT_KEY", value: sdkConnection.key }],
    status: "ready",
    projectId: project.id,
    sdkConnectionId: sdkConnection.id,
  };

  await integrationModel.update(integration, {
    resources: [...integration.resources, resource],
  });

  await syncVercelSdkConnection(org.id);

  return res.json(resource);
}

export async function getResource(req: Request, res: Response) {
  const { resource } = await authContext(req, res);

  if (!resource) return res.status(400).send("Resource not found!");

  return res.json(resource);
}

export async function updateResource(req: Request, res: Response) {
  const { org, integrationModel, integration, resource } = await authContext(
    req,
    res,
  );

  if (!resource) return res.status(400).send("Resource not found!");

  const payload = req.body as UpdateResource;

  const updatedResource = {
    ...resource,
    ...payload,
  };

  await integrationModel.update(integration, {
    resources: integration.resources.map((r) =>
      r.id === resource.id ? updatedResource : r,
    ),
  });

  await syncVercelSdkConnection(org.id);

  return res.json(updatedResource);
}

export async function getInstallationProducts(req: Request, res: Response) {
  const { integration } = await authContext(req, res);

  const plans = [...availableBillingPlans];

  // Make sure the current plan (if set) is included in the list
  if (integration) {
    const existingBillingPlan = allBillingPlans.find(
      ({ id }) => id === integration.billingPlanId,
    );
    if (existingBillingPlan) {
      const alreadyIncluded = plans.find(
        ({ id }) => id === existingBillingPlan.id,
      );
      if (!alreadyIncluded) {
        plans.unshift(existingBillingPlan);
      }
    }
  }

  return res.json({
    plans,
  });
}

async function removeManagedBy(
  context: ReqContext,
  managedBy: Partial<ManagedBy>,
) {
  await updateSdkConnectionsRemoveManagedBy(context, managedBy);
  await context.models.projects.removeManagedBy(managedBy);
}

export async function deleteResource(req: Request, res: Response) {
  const { context, integrationModel, integration, resource } =
    await authContext(req, res);

  if (!resource) return res.status(400).send("Resource not found!");

  await removeManagedBy(context, { type: "vercel", resourceId: resource.id });

  await integrationModel.update(integration, {
    resources: integration.resources.filter((r) => r.id !== resource.id),
  });

  await deleteVercelSdkWebhook(context);

  return res.sendStatus(204);
}

export async function getProducts(req: Request, res: Response) {
  const { integration } = await authContext(req, res);

  const slug = req.params.slug;

  if (!slug) return res.status(400).send("Invalid request!");

  const existingBillingPlan = allBillingPlans.find(
    ({ id }) => id === integration.billingPlanId,
  );

  if (!existingBillingPlan) {
    return res.json({
      plans: availableBillingPlans,
    });
  }

  const additionalProjectBillingPlan: BillingPlan = {
    ...existingBillingPlan,
    name: "Add GrowthBook Project to your existing plan",
    description: "",
    cost: "",
  };

  return res.json({ plans: [additionalProjectBillingPlan] });
}

export async function postVercelIntegrationSSO(req: Request, res: Response) {
  const { code, state, resourceId } = req.body;

  const token = await getVercelSSOToken({
    code: String(code),
    state: String(state),
  });

  const checkedToken = await checkAuth({ token, type: "user" });

  if (checkedToken.status === "error")
    return res.status(400).send("Invalid authentication token!");

  const {
    authentication: {
      payload: { user_email: userEmail, installation_id: installationId },
    },
  } = checkedToken;

  const vercelInstallation =
    await findVercelInstallationByInstallationId(installationId);

  if (!vercelInstallation)
    return res
      .status(400)
      .send(
        `Could not find installation for installationId: ${installationId}`,
      );

  const { org, resource } = await getOrgFromInstallationResource(
    installationId,
    resourceId,
  );

  const user = await findOrCreateUser(userEmail);

  // This is idempotent.
  await addMemberToOrg({
    organization: org,
    userId: user.id,
    role: "experimenter",
    projectRoles: [],
    managedByIdp: false,
    environments: [],
    limitAccessByEnvironment: false,
  });

  const trackingProperties = getUserLoginPropertiesFromRequest(req);
  trackLoginForUser({
    ...trackingProperties,
    email: userEmail,
  });

  SSOConnectionIdCookie.setValue(`vercel:${installationId}`, req, res);
  IdTokenCookie.setValue(token, req, res);

  res.send({
    organizationId: org.id,
    ...(resource ? { projectId: resource.projectId } : {}),
  });
}
