import crypto from "crypto";
import { Response } from "express";
import {
  AccountPlan,
  LicenseServerError,
  postCreateTrialEnterpriseLicenseToLicenseServer,
  postResendTrialLicenseEmailToLicenseServer,
  postVerifyEmailToLicenseServer,
} from "enterprise";
import {
  getLicenseMetaData,
  initializeLicenseForOrg,
} from "../services/licenseData";
import { getUserLicenseCodes } from "../services/users";
import { AuthRequest } from "../types/AuthRequest";
import { getContextFromReq } from "../services/organizations";
import { updateOrganization } from "../models/OrganizationModel";
import { PrivateApiErrorResponse } from "../../types/api";
import { updateSubscriptionInDb } from "../services/stripe";

/**
 * An endpoint mostly used to refresh the license data manually, if they
 * have only recently paid for a subscription or for more seats and don't
 * want to restart their servers.
 */
export async function getLicenseData(req: AuthRequest, res: Response) {
  req.checkPermissions("manageBilling");

  let licenseData;

  // TODO: Get rid of updateSubscriptionInDb one we have moved the license off the organizations
  if (req.organization?.subscription) {
    await updateSubscriptionInDb(req.organization.subscription.id);
  } else {
    // Force refresh the license data
    licenseData = await initializeLicenseForOrg(req.organization, true);
  }

  return res.status(200).json({
    status: 200,
    licenseData,
  });
}

/**
 * An endpoint to download license usage data, for use in organizations
 * that have an old style airgap license, so that they can download the
 * data and send it to us.
 */
export async function getLicenseReport(req: AuthRequest, res: Response) {
  req.checkPermissions("manageBilling");

  const timestamp = new Date().toISOString();
  const licenseMetaData = await getLicenseMetaData();
  const userLicenseCodes = await getUserLicenseCodes();

  // Create a hmac signature of the license data
  const hmac = crypto.createHmac("sha256", licenseMetaData.installationId);

  const report = {
    timestamp,
    licenseMetaData,
    userLicenseCodes,
  };

  return res.status(200).json({
    status: 200,
    ...report,
    signature: hmac.update(JSON.stringify(report)).digest("hex"),
  });
}

type CreateTrialEnterpriseLicenseRequest = AuthRequest<{
  email: string;
  name: string;
  organizationId: string;
  companyName: string;
  context: {
    organizationCreated: Date;
    currentSeats: number;
    currentPlan: AccountPlan;
    currentBuild: string;
    ctaSource: string;
  };
}>;

export async function postCreateTrialEnterpriseLicense(
  req: CreateTrialEnterpriseLicenseRequest,
  res: Response<{ status: 200 } | PrivateApiErrorResponse>
) {
  req.checkPermissions("manageBilling");

  const { org } = getContextFromReq(req);

  const { email, name, organizationId, companyName, context } = req.body;
  try {
    const results = await postCreateTrialEnterpriseLicenseToLicenseServer(
      email,
      name,
      organizationId,
      companyName,
      context
    );

    await updateOrganization(org.id, { licenseKey: results.licenseId });

    return res.status(200).json({ status: 200 });
  } catch (e) {
    if (e instanceof LicenseServerError) {
      return res
        .status(e.status)
        .json({ status: e.status, message: e.message });
    } else {
      throw e;
    }
  }
}

export async function postResendTrialLicenseEmail(
  req: AuthRequest,
  res: Response
) {
  req.checkPermissions("manageBilling");

  const { org } = getContextFromReq(req);

  try {
    await postResendTrialLicenseEmailToLicenseServer(org.id);

    return res.status(200).json({ status: 200 });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function postVerifyEmail(
  req: AuthRequest<{ emailVerificationToken: string }>,
  res: Response
) {
  const { emailVerificationToken } = req.body;

  try {
    await postVerifyEmailToLicenseServer(emailVerificationToken);

    // update license info from the license server as if the email was verified then the license data will be changed
    await initializeLicenseForOrg(req.organization, true);

    return res.status(200).json({ status: 200 });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}
