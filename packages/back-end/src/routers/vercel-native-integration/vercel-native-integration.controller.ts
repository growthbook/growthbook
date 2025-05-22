import crypto from "crypto";
import { Request, Response } from "express";
import { z } from "zod";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { v4 as uuidv4 } from "uuid";
import {
  findVercelInstallationByInstallationId,
  VercelNativeIntegrationModel,
  Resource,
  VercelNativeIntegration,
} from "back-end/src/models/VercelNativeIntegrationModel";
import {
  createOrganization,
  updateOrganization,
  findOrganizationById,
} from "back-end/src/models/OrganizationModel";
import { createUser, getUserByEmail } from "back-end/src/models/UserModel";
import { ReqContextClass } from "back-end/src/services/context";
import { OrganizationInterface } from "back-end/types/organization";
import {
  getVercelSSOToken,
  syncVercelSdkWebhook,
  deleteVercelSdkWebhook,
} from "back-end/src/services/vercel-native-integration.service";
import { createSDKConnection } from "back-end/src/models/SdkConnectionModel";
import { IdTokenCookie, SSOConnectionIdCookie } from "back-end/src/util/cookie";
import {
  getUserLoginPropertiesFromRequest,
  trackLoginForUser,
} from "back-end/src/services/users";
import {
  userAuthenticationValidator,
  systemAuthenticationValidator,
  UpsertInstallationPayload,
  ProvisitionResource,
  UpdateResource,
  BillingPlan,
} from "./vercel-native-integration.validators";

const FREE_BILLING_PLAN: BillingPlan = {
  description: "Free Billing Plan",
  id: "free-billing-plan",
  name: "Free",
  type: "subscription",
};

const NON_FREE_BILLING_PLAN: BillingPlan = {
  description: "Non Free Billing Plan",
  id: "non-free",
  name: "Non free",
  type: "subscription",
};

const billingPlans = [FREE_BILLING_PLAN, NON_FREE_BILLING_PLAN] as const;

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

const getOrgFromInstallationResource = async (
  installationId: string,
  resourceId?: string
): Promise<{
  org: OrganizationInterface;
  integration: VercelNativeIntegration;
  resource?: Resource;
}> => {
  const integration = await findVercelInstallationByInstallationId(
    installationId
  );

  if (!integration) throw new Error("Invalid installation!");

  const resource = (() => {
    if (!resourceId) return;

    const resource = integration.resources.find(({ id }) => id === resourceId);

    if (!resource) {
      throw new Error(`Invalid resourceId: ${resourceId}`);
    }

    return resource;
  })();

  const organizationId = resource?.organizationId || integration.organization;
  const org = await findOrganizationById(organizationId);

  if (!org) throw new Error("Invalid installation!");

  return {
    org,
    integration,
    resource,
  };
};

const getContext = async ({
  installationId,
  resourceId,
  res,
}: {
  installationId: string;
  resourceId?: string;
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

  // TODO: Verify the token is for an admin user (or system)
  const context = new ReqContextClass({
    org,
    auditUser: null,
    role: "admin",
  });

  // The model is attached to the top-level org so we
  // need a different context here!
  const topLevelOrg = await findOrganizationById(integration.organization);
  if (!topLevelOrg) return failed(400, "Invalid installation!");

  const topLevelContext = new ReqContextClass({
    org: topLevelOrg,
    auditUser: null,
    role: "admin",
  });

  const integrationModel = new VercelNativeIntegrationModel(topLevelContext);

  return {
    context,
    org,
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
    res,
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

  const user =
    (await getUserByEmail(payload.account.contact.email)) ||
    (await createUser({
      name: payload.account.name || payload.account.contact.email.split("@")[0],
      email: payload.account.contact.email,
      password: crypto.randomBytes(18).toString("hex"),
    }));

  const installationName = `Vercel instalation ${authentication.payload.installation_id}`;

  const org = await createOrganization({
    email: payload.account.contact.email,
    userId: user.id,
    name: installationName,
    isVercelIntegration: true,
    restrictLoginMethod: "vercel",
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
  await authContext(req, res);
  return res.json();
}

export async function updateInstallation(req: Request, res: Response) {
  // We don't support installation-level billing plans!
  return res.status(400).send("Invalid request!");
}

export async function deleteInstallation(req: Request, res: Response) {
  const { integrationModel, integration } = await authContext(req, res);

  await integrationModel.deleteById(integration.id);

  return res.status(200).send({ finalized: true });
}

export async function provisionResource(req: Request, res: Response) {
  const { org: contextOrg, integrationModel, integration } = await authContext(
    req,
    res
  );

  const {
    externalId: _externalId,
    billingPlanId,
    ...payload
  } = req.body as ProvisitionResource;

  const billingPlan = billingPlans.find(({ id }) => id === billingPlanId);

  if (!billingPlan) return res.status(400).send("Invalid billing plan!");

  const org = await (async () => {
    if (integration.resources.length === 0) {
      await updateOrganization(contextOrg.id, {
        name: payload.name,
        isVercelIntegration: true,
        restrictLoginMethod: "vercel",
      });
      return contextOrg;
    }

    return createOrganization({
      email: contextOrg.ownerEmail,
      // TODO: Better way to get the userId
      userId: contextOrg.members.find((m) => m.role === "admin")?.id || "",
      name: payload.name,
      isVercelIntegration: true,
      restrictLoginMethod: "vercel",
    });
  })();

  const sdkConnection = await createSDKConnection({
    organization: org.id,
    name: payload.name,
    languages: ["react"],
    environment: "production",
    includeVisualExperiments: true,
    includeDraftExperiments: true,
    includeRuleIds: true,
    includeRedirectExperiments: false,
    includeExperimentNames: true,
    hashSecureAttributes: false,
    projects: [],
    encryptPayload: false,
  });

  const resource: Resource = {
    ...payload,
    id: uuidv4(),
    organizationId: org.id,
    billingPlan,
    secrets: [{ name: "GROWTHBOOK_CLIENT_KEY", value: sdkConnection.key }],
    status: "ready",
  };

  await integrationModel.update(integration, {
    resources: [...integration.resources, resource],
  });

  await syncVercelSdkWebhook(org.id);

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
    res
  );

  if (!resource) return res.status(400).send("Resource not found!");

  const { billingPlanId, ...payload } = req.body as UpdateResource;

  const updatedBillingPlan = billingPlanId
    ? billingPlans.find(({ id }) => id === billingPlanId)
    : undefined;

  if (billingPlanId && !updatedBillingPlan)
    return res.status(400).send("Invalid billing plan!");

  const updatedResource = {
    ...resource,
    ...payload,
    ...(updatedBillingPlan ? { billingPlan: updatedBillingPlan } : {}),
  };

  await integrationModel.update(integration, {
    resources: integration.resources.map((r) =>
      r.id === resource.id ? updatedResource : r
    ),
  });

  await syncVercelSdkWebhook(org.id);

  return res.json(updatedResource);
}

export async function getResourceProducts(req: Request, res: Response) {
  await authContext(req, res);

  return res.json({ plans: billingPlans });
}

export async function deleteResource(req: Request, res: Response) {
  const {
    context,
    org,
    integrationModel,
    integration,
    resource,
  } = await authContext(req, res);

  if (!resource) return res.status(400).send("Resource not found!");

  await integrationModel.update(integration, {
    resources: integration.resources.filter((r) => r.id !== resource.id),
  });

  await deleteVercelSdkWebhook(context);

  await updateOrganization(
    org.id,
    {
      isVercelIntegration: false,
    },
    { restrictLoginMethod: 1 }
  );

  return res.sendStatus(204);
}

export async function getProducts(req: Request, res: Response) {
  await authContext(req, res);

  const slug = req.params.slug;

  if (!slug) return res.status(400).send("Invalid request!");

  return res.json({ plans: billingPlans });
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

  const vercelInstallation = await findVercelInstallationByInstallationId(
    installationId
  );

  if (!vercelInstallation)
    return res
      .status(400)
      .send(
        `Could not find installation for installationId: ${installationId}`
      );

  const { org } = await getOrgFromInstallationResource(
    installationId,
    resourceId
  );

  const trackingProperties = getUserLoginPropertiesFromRequest(req);
  trackLoginForUser({
    ...trackingProperties,
    email: userEmail,
  });

  // TODO: How long do Vercel tokens last? Is 600 (10 minutes) correct?
  const maxAge = 600;
  SSOConnectionIdCookie.setValue("vercel", req, res, maxAge);
  IdTokenCookie.setValue(token, req, res, maxAge);

  res.send({ organizationId: org.id });
}
