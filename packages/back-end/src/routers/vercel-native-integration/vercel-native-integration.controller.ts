import crypto from "crypto";
import { Request, Response } from "express";
import { z } from "zod";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { v4 as uuidv4 } from "uuid";
import { VercelNativeIntegrationModel } from "back-end/src/models/VercelNativeIntegration";
import {
  createOrganization,
  findOrganizationByVercelInstallationId,
} from "back-end/src/models/OrganizationModel";
import { createUser, getUserByEmail } from "back-end/src/models/UserModel";
import { ReqContextClass } from "back-end/src/services/context";
import {
  userAuthenticationValidator,
  systemAuthenticationValidator,
  UpsertInstallationPayload,
  UpdateInstallation,
  ProvisitionResource,
  Resource,
  BillingPlan,
} from "./vercel-native-integration.validators";

const DEFAULT_BILLING_PLAN: BillingPlan = {
  description: "Dev test",
  id: "dev-test",
  name: "Dev test",
  type: "subscription",
};

const DEFAULT_PRODUCT = "dev-test";

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

  const org = await findOrganizationByVercelInstallationId(
    authentication.payload.installation_id
  );

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
    installationId: authentication.payload.installation_id,
    organization: org.id,
  });

  if (!nativeIntegration) return failed(400, "Invalid installation!");

  return { context, org, user, nativeIntegrationModel, nativeIntegration };
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

  return res.send(JSON.stringify(DEFAULT_BILLING_PLAN));
}

export async function getInstallation(req: Request, res: Response) {
  const { nativeIntegration } = await authContext(req, res);

  if (nativeIntegration.installationId !== req.params.installation_id)
    return res.status(400).send("Invalid request!");

  return res.send(JSON.stringify(DEFAULT_BILLING_PLAN));
}

export async function updateInstallation(req: Request, res: Response) {
  const { nativeIntegrationModel, nativeIntegration } = await authContext(
    req,
    res
  );

  if (nativeIntegration.installationId !== req.params.installation_id)
    return res.status(400).send("Invalid request!");

  const { billingPlanId } = req.body as UpdateInstallation;

  await nativeIntegrationModel.update(nativeIntegration, { billingPlanId });

  return res.sendStatus(204);
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
    productId: DEFAULT_PRODUCT,
    secrets: [{ name: "token", value: uuidv4() }],
    status: "ready",
  };

  await nativeIntegrationModel.update(nativeIntegration, {
    resources: [...(nativeIntegration.resources || []), resource],
  });

  return res.send(JSON.stringify(resource));
}

export async function getResource(req: Request, res: Response) {
  const { nativeIntegration } = await authContext(req, res);

  if (nativeIntegration.installationId !== req.params.installation_id)
    return res.status(400).send("Invalid request!");

  const resource = (nativeIntegration.resources || []).find(
    ({ id }) => id === req.params.resource_id
  );

  if (!resource) return res.sendStatus(404);

  return res.send(JSON.stringify(resource));
}

export async function getProducts(req: Request, res: Response) {
  await authContext(req, res);

  const slug = req.params.slug;

  if (!slug) return res.status(400).send("Invalid request!");

  return res.send(JSON.stringify({ plans: [DEFAULT_BILLING_PLAN] }));
}
