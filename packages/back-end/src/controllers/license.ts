import crypto from "crypto";
import { Response } from "express";
import {
  AccountPlan,
  LicenseServerError,
  postCreateTrialEnterpriseLicenseToLicenseServer,
  postResendEmailVerificationEmailToLicenseServer,
  postVerifyEmailToLicenseServer,
} from "enterprise";
import md5 from "md5";
import {
  getLicenseMetaData,
  initializeLicenseForOrg,
} from "../services/licenseData";
import { getUserLicenseCodes } from "../services/users";
import { AuthRequest } from "../types/AuthRequest";
import { getContextFromReq } from "../services/organizations";
import {
  getAllInviteEmailsInDb,
  updateOrganization,
} from "../models/OrganizationModel";
import { PrivateApiErrorResponse } from "../../types/api";
import { updateSubscriptionInDb } from "../services/stripe";

/**
 * An endpoint mostly used to refresh the license data manually, if they
 * have only recently paid for a subscription or for more seats and don't
 * want to restart their servers.
 */
export async function getLicenseData(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageBilling()) {
    context.permissions.throwPermissionError();
  }

  let licenseData;

  if (req.organization?.licenseKey || process.env.LICENSE_KEY) {
    // Force refresh the license data
    licenseData = await initializeLicenseForOrg(req.organization, true);
  } else if (req.organization?.subscription) {
    // TODO: Get rid of updateSubscriptionInDb one we have moved the license off the organizations
    // This is to update the subscription data in the organization from stripe if they have it
    await updateSubscriptionInDb(req.organization.subscription.id);
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
  const context = getContextFromReq(req);

  if (!context.permissions.canManageBilling()) {
    context.permissions.throwPermissionError();
  }

  const timestamp = new Date().toISOString();
  const licenseMetaData = await getLicenseMetaData();
  const userEmailCodes = await getUserLicenseCodes();
  const inviteEmails = await getAllInviteEmailsInDb();
  const inviteEmailCodes: string[] = inviteEmails.map((email) => {
    return md5(email).slice(0, 8);
  });

  // Create a hmac signature of the license data
  const hmac = crypto.createHmac("sha256", licenseMetaData.installationId);

  const report = {
    timestamp,
    licenseMetaData,
    userEmailCodes,
    inviteEmailCodes,
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
  const context = getContextFromReq(req);
  const { org } = context;

  if (!context.permissions.canManageBilling()) {
    context.permissions.throwPermissionError();
  }

  const {
    email,
    name,
    organizationId,
    companyName,
    context: reqContext,
  } = req.body;
  try {
    const results = await postCreateTrialEnterpriseLicenseToLicenseServer(
      email,
      name,
      organizationId,
      companyName,
      reqContext
    );

    if (!org.licenseKey) {
      await updateOrganization(org.id, { licenseKey: results.licenseId });
    } else {
      await initializeLicenseForOrg(req.organization, true);
    }
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

export async function postResendEmailVerificationEmail(
  req: AuthRequest,
  res: Response
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageBilling()) {
    context.permissions.throwPermissionError();
  }

  try {
    await postResendEmailVerificationEmailToLicenseServer(context.org.id);

    return res.status(200).json({ status: 200 });
  } catch (e) {
    return res.status(500).json({ status: 500, message: e.message });
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
    return res.status(500).json({ status: 500, message: e.message });
  }
}
