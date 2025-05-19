import crypto from "crypto";
import { Request, Response } from "express";
import { z } from "zod";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { v4 as uuidv4 } from "uuid";
import {
  findVercelInstallationByInstallationId,
  VercelNativeIntegrationModel,
  Resource,
} from "back-end/src/models/VercelNativeIntegrationModel";
import {
  createOrganization,
  updateOrganization,
  findOrganizationById,
} from "back-end/src/models/OrganizationModel";
import { createUser, getUserByEmail } from "back-end/src/models/UserModel";
import { ReqContextClass } from "back-end/src/services/context";
import { setResponseCookies } from "back-end/src/controllers/auth";
import { OrganizationInterface } from "back-end/types/organization";
import {
  getVercelSSOToken,
  syncVercelSdkWebhook,
} from "back-end/src/services/vercel-native-integration.service";
import { createSDKConnection } from "back-end/src/models/SdkConnectionModel";
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
  BillingPlan,
} from "./vercel-native-integration.validators";

const STARTER_BILLING_PLAN: BillingPlan = {
  description:
    "Growthbook's free plan. Add up to 3 users. Enjoy unlimited feature flag evaluations, community support, up to 1M CDN requests/month, and up to 5GB of CDN Bandwidth/month.",
  id: "starter-billing-plan",
  name: "Starter (Free) Plan",
  type: "subscription",
};

const PRO_BILLING_PLAN: BillingPlan = {
  description:
    "Enjoy all the benefits of our starter plan, plus add up to 100 members (each member incurs a cost of $20/month), get in-app chat support, up to 2M CDN requests/month, and up to 20GB of CDN Bandwidth/month.",
  id: "pro-billing-plan",
  name: "Pro Plan",
  type: "subscription",
  cost: "20.00/month per user + usage",
  details: [{ label: "label", value: "value" }],
  highlightedDetails: [
    { label: "highlighted label", value: "highlighted value" },
  ],
};

const billingPlans = [STARTER_BILLING_PLAN, PRO_BILLING_PLAN] as const;

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

const addOrganizationUser = (id: string, organization: OrganizationInterface) =>
  updateOrganization(organization.id, {
    members: [
      ...organization.members,
      {
        id,
        role: "admin",
        dateCreated: new Date(),
        limitAccessByEnvironment: false,
        environments: [],
      },
    ],
  });

const findOrCreateUser = async ({
  email,
  organization,
}: {
  email: string;
  organization: OrganizationInterface;
}) => {
  const existingUser = await getUserByEmail(email);

  if (existingUser) {
    if (!organization.members.find(({ id }) => existingUser.id === id))
      await addOrganizationUser(existingUser.id, organization);
    return existingUser;
  }

  const newUser = await createUser({
    name: email.split("@")[0],
    email,
    password: crypto.randomBytes(18).toString("hex"),
  });

  await addOrganizationUser(newUser.id, organization);

  return newUser;
};

const getContext = async ({
  organizationId,
  installationId,
  userEmail,
  res,
}: {
  organizationId: string;
  installationId: string;
  userEmail?: string;
  res: Response;
}) => {
  const failed = (status: number, reason?: string) => {
    if (reason) res.status(status).send(reason);
    else res.sendStatus(status);

    throw new Error("Authentication failed");
  };

  const org = await findOrganizationById(organizationId);

  if (!org) return failed(400, "Invalid installation!");

  const user = await findOrCreateUser({
    email: userEmail || org.ownerEmail,
    organization: org,
  });

  const context = new ReqContextClass({
    org,
    auditUser: null,
    user,
  });

  const nativeIntegrationModel = new VercelNativeIntegrationModel(context);

  const nativeIntegration = await findVercelInstallationByInstallationId(
    installationId
  );

  if (!nativeIntegration) return failed(400, "Invalid installation!");

  return {
    context,
    org,
    user,
    nativeIntegrationModel,
    nativeIntegration,
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

  const { organization } = await findVercelInstallationByInstallationId(
    installationId
  );

  return getContext({
    organizationId: organization,
    installationId,
    userEmail:
      "user_email" in checkedAuth.authentication.payload &&
      typeof checkedAuth.authentication.payload.user_email === "string"
        ? checkedAuth.authentication.payload.user_email
        : undefined,
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
    (await await getUserByEmail(payload.account.contact.email)) ||
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

  const nativeIntegrationModel = new VercelNativeIntegrationModel(context);

  await nativeIntegrationModel.create({
    installationId: authentication.payload.installation_id,
    upsertData: { payload, authentication: authentication.payload },
    resources: [],
  });

  return res.sendStatus(204);
}

export async function getInstallation(req: Request, res: Response) {
  const { nativeIntegration } = await authContext(req, res);

  if (nativeIntegration.installationId !== req.params.installation_id)
    return res.status(400).send("Invalid request!");

  return res.json();
}

export async function updateInstallation(req: Request, res: Response) {
  // We don't support installation-level billing plans!
  return res.status(400).send("Invalid request!");
}

export async function deleteInstallation(req: Request, res: Response) {
  const { nativeIntegrationModel, nativeIntegration, org } = await authContext(
    req,
    res
  );

  if (nativeIntegration.installationId !== req.params.installation_id)
    return res.status(400).send("Invalid request!");

  if (!org.licenseKey) {
    return res.status(404).send(`Unable to locate license for org: ${org.id}`);
  }

  const license = await getLicenseByKey(org.licenseKey);

  if (!license) {
    return res.status(404).send(`Unable to locate license for org: ${org.id}`);
  }

  // Cancel their subscription
  await postCancelSubscriptionToLicenseServer(license.id);

  // TODO: cascade delete
  await nativeIntegrationModel.deleteById(nativeIntegration.id);

  return res.status(200).send({ finalized: true });
}

export async function provisionResource(req: Request, res: Response) {
  const {
    user,
    org: contextOrg,
    nativeIntegrationModel,
    nativeIntegration,
  } = await authContext(req, res);

  const {
    externalId: _externalId,
    billingPlanId,
    ...payload
  } = req.body as ProvisitionResource;

  const billingPlan = billingPlans.find(({ id }) => id === billingPlanId);

  if (!billingPlan) return res.status(400).send("Invalid billing plan!");

  const org = await (async () => {
    if (nativeIntegration.resources.length === 0) {
      await updateOrganization(contextOrg.id, { name: payload.name });
      return contextOrg;
    }

    return createOrganization({
      email: user.email,
      userId: user.id,
      name: payload.name,
      isVercelIntegration: true,
      restrictLoginMethod: "vercel",
    });
  })();

  if (billingPlanId === "pro-billing-plan") {
    try {
      await postNewVercelSubscriptionToLicenseServer(
        org,
        req.params.installation_id,
        user.name || ""
      );
    } catch (e) {
      throw new Error(
        `Unable to create new subscription. Reason: ${e.message} || "Unknown`
      );
    }
  }
  const sdkConnection = await createSDKConnection({
    organization: org.id,
    name: payload.name,
    languages: ["react"],
    environment: "dev",
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
    secrets: [
      { name: "GROWTHBOOK_CLIENT_KEY", value: sdkConnection.key },
      { name: "GROWTHBOOK_DOMAIN", value: "https://app.growthbook.io" },
    ],
    status: "ready",
  };

  await nativeIntegrationModel.update(nativeIntegration, {
    resources: [...nativeIntegration.resources, resource],
  });

  await syncVercelSdkWebhook(org.id);

  return res.json(resource);
}

export async function getResource(req: Request, res: Response) {
  const { nativeIntegration } = await authContext(req, res);

  if (nativeIntegration.installationId !== req.params.installation_id)
    return res.status(400).send("Installation not found!");

  const resource = nativeIntegration.resources.find(
    ({ id }) => id === req.params.resource_id
  );

  if (!resource) return res.status(400).send("Resource not found!");

  return res.json(resource);
}

export async function updateResource(req: Request, res: Response) {
  const { org, nativeIntegrationModel, nativeIntegration } = await authContext(
    req,
    res
  );

  if (nativeIntegration.installationId !== req.params.installation_id)
    return res.status(400).send("Installation not found!");

  const resource = nativeIntegration.resources.find(
    ({ id }) => id === req.params.resource_id
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

  await nativeIntegrationModel.update(nativeIntegration, {
    resources: nativeIntegration.resources.map((r) =>
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
  const { nativeIntegrationModel, nativeIntegration } = await authContext(
    req,
    res
  );

  if (nativeIntegration.installationId !== req.params.installation_id)
    return res.status(400).send("Invalid request!");

  const resource = nativeIntegration.resources.find(
    ({ id }) => id === req.params.resource_id
  );

  if (!resource) return res.status(400).send("Resource not found!");

  await nativeIntegrationModel.update(nativeIntegration, {
    resources: nativeIntegration.resources.map((r) =>
      r.id === resource.id ? { ...resource, status: "uninstalled" } : r
    ),
  });

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

  const organizationId = (() => {
    if (!resourceId) return vercelInstallation.organization;

    const resource = vercelInstallation.resources.find(
      ({ id }) => id === resourceId
    );

    if (!resource) {
      res.status(400).send("Invalid request!");
      throw new Error(`Invalid resourceId: ${resourceId}`);
    }

    return resource.organizationId;
  })();

  const { user } = await getContext({
    organizationId,
    installationId,
    userEmail,
    res,
  });

  await setResponseCookies(req, res, user);

  res.send({ organizationId });
}
