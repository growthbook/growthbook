import crypto from "crypto";
import { Request, Response } from "express";
import { z } from "zod";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { v4 as uuidv4 } from "uuid";
import {
  findVercelInstallationIdByResourceId,
  VercelNativeIntegrationModel,
} from "back-end/src/models/VercelNativeIntegration";
import {
  createOrganization,
  findOrganizationByVercelInstallationId,
} from "back-end/src/models/OrganizationModel";
import { createUser, getUserByEmail } from "back-end/src/models/UserModel";
import { ReqContextClass } from "back-end/src/services/context";
import { sendLocalSuccessResponse } from "back-end/src/controllers/auth";
import {
  userAuthenticationValidator,
  systemAuthenticationValidator,
  UpsertInstallationPayload,
  ProvisitionResource,
  Resource,
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

const getContext = async ({
  installationId,
  res,
}: {
  installationId: string;
  res: Response;
}) => {
  const failed = (status: number, reason?: string) => {
    if (reason) res.status(status).send(reason);
    else res.sendStatus(status);

    throw "Authentication failed";
  };

  const org = await findOrganizationByVercelInstallationId(installationId);

  if (!org) return failed(400, "Invalid installation!");

  const user = await getUserByEmail(org.ownerEmail);

  if (!user) return failed(400, "Invalid installation!");

  const context = new ReqContextClass({
    org,
    auditUser: null,
    user,
  });

  const nativeIntegrationModel = new VercelNativeIntegrationModel(context);

  const nativeIntegration = await nativeIntegrationModel.getByInstallationId({
    installationId,
    organization: org.id,
  });

  if (!nativeIntegration) return failed(400, "Invalid installation!");

  return { context, org, user, nativeIntegrationModel, nativeIntegration };
};

const authContext = async (req: Request, res: Response) => {
  const failed = (status: number, reason?: string) => {
    if (reason) res.status(status).send(reason);
    else res.sendStatus(status);

    throw "Authentication failed";
  };

  const token = getBearerToken(req);

  if (!token) return failed(401, "Invalid credentials");

  const checkedAuth = await checkAuth({
    token,
    type: String(req.headers["x-vercel-auth"]),
  });

  if (checkedAuth.status === "error") return failed(401, checkedAuth.message);

  const { authentication } = checkedAuth;

  return getContext({
    installationId: authentication.payload.installation_id,
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

  const installationName =
    payload.account.name ||
    `Vercel instalation ${authentication.payload.installation_id}`;

  const user =
    (await getUserByEmail(payload.account.contact.email)) ||
    (await createUser({
      name: installationName,
      email: payload.account.contact.email,
      password: crypto.randomBytes(18).toString("hex"),
    }));

  const org = await createOrganization({
    email: payload.account.contact.email,
    userId: user.id,
    externalId: authentication.payload.installation_id,
    name: installationName,
    vercelIntegration: true,
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
  const { nativeIntegrationModel, nativeIntegration } = await authContext(
    req,
    res
  );

  if (nativeIntegration.installationId !== req.params.installation_id)
    return res.status(400).send("Invalid request!");

  // TODO: cascade delete
  await nativeIntegrationModel.deleteById(nativeIntegration.id);

  return res.sendStatus(204);
}

export async function provisionResource(req: Request, res: Response) {
  const { nativeIntegrationModel, nativeIntegration } = await authContext(
    req,
    res
  );

  if (nativeIntegration.installationId !== req.params.installation_id)
    return res.status(400).send("Invalid request!");

  const {
    externalId: _externalId,
    ...payload
  } = req.body as ProvisitionResource;

  const resource: Resource = {
    ...payload,
    id: uuidv4(),
    secrets: [{ name: "token", value: uuidv4() }],
    status: "ready",
  };

  await nativeIntegrationModel.update(nativeIntegration, { resource });

  return res.json(resource);
}

export async function getResource(req: Request, res: Response) {
  const { nativeIntegration } = await authContext(req, res);

  if (nativeIntegration.installationId !== req.params.installation_id)
    return res.status(400).send("Invalid request!");

  if (nativeIntegration.resource?.id !== req.params.resource_id)
    return res.status(400).send("Invalid request!");

  return res.json(nativeIntegration.resource);
}

export async function deleteResource(req: Request, res: Response) {
  const { nativeIntegrationModel, nativeIntegration } = await authContext(
    req,
    res
  );

  if (nativeIntegration.installationId !== req.params.installation_id)
    return res.status(400).send("Invalid request!");

  if (nativeIntegration.resource?.id !== req.params.resource_id)
    return res.status(400).send("Invalid request!");

  await nativeIntegrationModel.update(nativeIntegration, {
    resource: undefined,
  });

  return res.sendStatus(204);
}

export async function getProducts(req: Request, res: Response) {
  await authContext(req, res);

  const slug = req.params.slug;

  if (!slug) return res.status(400).send("Invalid request!");

  return res.json({ plans: billingPlans });
}

const VERCEL_URL = "https://api.vercel.com";

const VERCEL_CLIENT_ID = "oac_3hOBpTjMhOxQtMxq8zfKOqUm";
const VERCEL_CLIENT_SECRET = "ROFdNRGEkd1j49WQGAKAO9aV";

export async function postVercelIntegrationSSO(req: Request, res: Response) {
  const { code, resourceId } = req.body;

  const installationId = await findVercelInstallationIdByResourceId(resourceId);

  if (!installationId) return res.status(400).send("Invalid request!");

  const { user } = await getContext({ installationId, res });

  await fetch(`${VERCEL_URL}/v1/integrations/sso/token`, {
    method: "POST",
    body: JSON.stringify({
      code,
      client_id: VERCEL_CLIENT_ID,
      client_secret: VERCEL_CLIENT_SECRET,
    }),
    headers: {
      "Content-Type": "application/json",
    },
  });

  return sendLocalSuccessResponse(req, res, user);
}
