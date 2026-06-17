import type { Request, Response } from "express";
import {
  CliAuthInitBody,
  CliAuthInitResponse,
  CliAuthApproveBody,
  CliAuthApproveResponse,
  CliAuthExchangeBody,
  CliAuthExchangeResponse,
  CliAuthRequestDetails,
} from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { getCollection } from "back-end/src/util/mongo.util";
import { COLLECTION_NAME as API_KEYS_COLLECTION } from "back-end/src/models/ApiKeyModel";
import {
  createCliAuthRequest,
  getCliAuthRequestById,
  approveCliAuthRequest,
  verifyAndConsumeExchange,
  recordApiKeyOnRequest,
  isRequestExpired,
} from "back-end/src/models/CliAuthRequestModel";

// region POST /cli-auth/init (PUBLIC)

type InitErrorResponse = { status: number; message: string };

export const postInit = async (
  req: Request<unknown, unknown, CliAuthInitBody>,
  res: Response<CliAuthInitResponse | InitErrorResponse>,
) => {
  const { clientName, codeChallenge, codeChallengeMethod, suggestedOrgName } =
    req.body;

  const created = await createCliAuthRequest({
    clientName,
    codeChallenge,
    codeChallengeMethod,
    suggestedOrgName,
  });

  const approveUrl = new URL("/cli-auth", APP_ORIGIN);
  approveUrl.searchParams.set("req", created.requestId);

  return res.status(200).json({
    requestId: created.requestId,
    expiresAt: created.expiresAt.toISOString(),
    approveUrl: approveUrl.toString(),
  });
};

// endregion POST /cli-auth/init

// region GET /cli-auth/request/:id (AUTHED, for SPA approval page)

type GetRequestParams = { id: string };
type GetRequestResponse = CliAuthRequestDetails | InitErrorResponse;

export const getRequest = async (
  req: AuthRequest<unknown, GetRequestParams>,
  res: Response<GetRequestResponse>,
) => {
  const { id } = req.params;
  const doc = await getCliAuthRequestById(id);
  if (!doc) {
    return res.status(404).json({ status: 404, message: "Request not found" });
  }
  if (isRequestExpired(doc)) {
    return res.status(410).json({ status: 410, message: "Request expired" });
  }
  return res.status(200).json({
    requestId: doc.requestId,
    clientName: doc.clientName,
    suggestedOrgName: doc.suggestedOrgName,
    status: doc.status,
    expiresAt: doc.expiresAt.toISOString(),
  });
};

// endregion GET /cli-auth/request/:id

// region POST /cli-auth/approve (AUTHED)

type ApproveRequest = AuthRequest<CliAuthApproveBody>;
type ApproveResponse = CliAuthApproveResponse | InitErrorResponse;

export const postApprove = async (
  req: ApproveRequest,
  res: Response<ApproveResponse>,
) => {
  const { requestId, organization, loopbackPort } = req.body;
  const context = getContextFromReq(req);

  // Body's organization must match the user's current org context.
  // The SPA sends X-Organization for the org picked on the approval page.
  if (organization !== context.org.id) {
    return res
      .status(400)
      .json({ status: 400, message: "Organization mismatch" });
  }

  const existing = await getCliAuthRequestById(requestId);
  if (!existing) {
    return res.status(404).json({ status: 404, message: "Request not found" });
  }
  if (isRequestExpired(existing)) {
    return res.status(410).json({ status: 410, message: "Request expired" });
  }
  if (existing.status !== "pending") {
    return res
      .status(409)
      .json({ status: 409, message: "Request already used" });
  }

  // POC: mint PAT now. Hardening will defer minting to /exchange so a dead
  // loopback listener doesn't leave orphan tokens (see CLI_AUTH_DESIGN.md).
  const hostname =
    (req.headers["x-cli-auth-hostname"] as string | undefined) || "unknown";
  const description = formatPatDescription(existing.clientName, hostname);

  const apiKey = await context.models.apiKeys.createUserPersonalAccessApiKey({
    userId: context.userId,
    description,
  });

  const approval = await approveCliAuthRequest({
    requestId,
    userId: context.userId,
    organizationId: context.org.id,
    loopbackPort,
  });
  if (!approval) {
    // Race lost — another approval beat us, or request expired between checks.
    return res
      .status(409)
      .json({ status: 409, message: "Request no longer pending" });
  }
  if (apiKey.id) {
    await recordApiKeyOnRequest(requestId, apiKey.id);
  }

  const redirectUri = new URL(`http://127.0.0.1:${loopbackPort}/callback`);
  redirectUri.searchParams.set("code", approval.exchangeCode);
  redirectUri.searchParams.set("state", requestId);

  return res.status(200).json({
    exchangeCode: approval.exchangeCode,
    redirectUri: redirectUri.toString(),
  });
};

function formatPatDescription(clientName: string, hostname: string): string {
  const date = new Date().toISOString().slice(0, 10);
  // PAT description has no length limit in the validator today, but truncate
  // defensively in case a length cap is added.
  const out = `CLI: ${clientName} (${hostname}) — ${date}`;
  return out.length > 500 ? out.slice(0, 500) : out;
}

// endregion POST /cli-auth/approve

// region POST /cli-auth/exchange (PUBLIC)

type ExchangeRequest = Request<unknown, unknown, CliAuthExchangeBody>;
type ExchangeResponse = CliAuthExchangeResponse | InitErrorResponse;

export const postExchange = async (
  req: ExchangeRequest,
  res: Response<ExchangeResponse>,
) => {
  const { requestId, exchangeCode, codeVerifier } = req.body;

  const result = await verifyAndConsumeExchange({
    requestId,
    exchangeCode,
    codeVerifier,
  });
  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "expired"
          ? 410
          : result.reason === "too_many_attempts"
            ? 429
            : 400;
    return res.status(status).json({
      status,
      message: `Exchange failed: ${result.reason}`,
    });
  }

  const doc = result.doc;
  if (!doc.apiKeyId || !doc.organizationId || !doc.userId) {
    return res.status(500).json({
      status: 500,
      message: "Approved request is missing required fields",
    });
  }

  // Read unredacted key directly from the apikeys collection. This bypasses the
  // ApiKeyModel's sanitization (which strips `key` on read). Safe because:
  //   - The exchange has just verified PKCE verifier and the one-time code
  //   - The key was minted for this exact request by an authenticated user
  const apiKeyDoc = await getCollection(API_KEYS_COLLECTION).findOne({
    id: doc.apiKeyId,
    organization: doc.organizationId,
  });
  if (!apiKeyDoc || typeof apiKeyDoc.key !== "string") {
    return res.status(500).json({ status: 500, message: "Token not found" });
  }

  // Look up user email for the response (helpful for the agent to confirm).
  const userDoc = await getCollection("users").findOne({ id: doc.userId });
  const userEmail =
    userDoc && typeof userDoc.email === "string" ? userDoc.email : "";

  return res.status(200).json({
    apiKey: apiKeyDoc.key,
    organization: doc.organizationId,
    userEmail,
    keyId: doc.apiKeyId,
  });
};

// endregion POST /cli-auth/exchange
