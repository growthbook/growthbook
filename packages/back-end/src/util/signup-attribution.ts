import { CookieOptions } from "express";
import { freeEmailDomains } from "free-email-domains-typescript";
import {
  attributionCookieSchema,
  AttributionCookie,
  SignupAttribution,
  signupAttributionSchema,
  SignupAttributionPayload,
} from "shared/validators";
import {
  callLicenseServer,
  LICENSE_SERVER_URL,
} from "back-end/src/enterprise/licenseUtil";
import { logger } from "back-end/src/util/logger";
import { CLOUD_SECRET, IS_CLOUD } from "back-end/src/util/secrets";

const COOKIE_NAME = "gb_attr";
const COOKIE_MAX_AGE_DAYS = 30;

type RequestWithCookies = { cookies?: Record<string, string> };
type ResponseWithSetCookie = {
  cookie: (name: string, value: string, options: CookieOptions) => unknown;
};

export function classifyEmail(email: string): "free" | "business" {
  const domain = email.toLowerCase().split("@")[1] || "";
  return freeEmailDomains.includes(domain) ? "free" : "business";
}

export function parseAttributionCookie(
  req: RequestWithCookies,
): AttributionCookie {
  const raw = req.cookies?.[COOKIE_NAME];
  if (!raw) return {};
  try {
    const result = attributionCookieSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

/**
 * Narrow a parsed gb_attr cookie to the known fields we persist on the
 * organization document, dropping empty values. Returns undefined when there
 * is nothing to store. The parse can't throw here: the input already passed
 * the same field checks, and unknown keys are stripped rather than rejected.
 */
export function getOrgSignupAttribution(
  attribution: AttributionCookie,
): SignupAttribution | undefined {
  const fields = Object.entries(
    signupAttributionSchema.parse(attribution),
  ).filter(([, value]) => !!value);
  return fields.length ? Object.fromEntries(fields) : undefined;
}

/**
 * Re-issue gb_attr via a server-set Set-Cookie header so Safari ITP's
 * 7-day cap on JS-set cookies doesn't expire it before org creation.
 * Called from postOAuthCallback to harden the cookie for the gap between
 * completing OAuth and clicking "Create Organization."
 */
export function reissueAttributionCookie(
  req: RequestWithCookies,
  res: ResponseWithSetCookie,
) {
  const raw = req.cookies?.[COOKIE_NAME];
  if (!raw) return;
  try {
    res.cookie(COOKIE_NAME, raw, {
      domain: ".growthbook.io",
      path: "/",
      maxAge: COOKIE_MAX_AGE_DAYS * 86400 * 1000,
      sameSite: "lax",
      secure: true,
      httpOnly: false,
    });
  } catch (e) {
    logger.warn("Failed to reissue attribution cookie", e);
  }
}

/**
 * Forward a parsed attribution payload to central-license-server.
 * Best-effort: caller wraps in try/catch and never blocks org creation.
 * No-ops on self-hosted (IS_CLOUD === false).
 */
export async function postSignupAttributionToLicenseServer(
  payload: SignupAttributionPayload,
) {
  if (!IS_CLOUD) return;
  if (!CLOUD_SECRET) {
    logger.warn(
      "CLOUD_SECRET not set; skipping signup attribution license-server forward",
    );
    return;
  }
  const url = `${LICENSE_SERVER_URL}signup-attribution`;
  return callLicenseServer({
    url,
    body: JSON.stringify({
      ...payload,
      cloudSecret: CLOUD_SECRET,
    }),
  });
}
