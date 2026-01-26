import crypto from "crypto";
import { Response } from "express";
import { AccountPlan } from "shared/enterprise";
import { LicenseServerError } from "back-end/src/util/errors";
import {
  getLicenseMetaData,
  getUserCodesForOrg,
} from "back-end/src/services/licenseData";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { PrivateApiErrorResponse } from "back-end/types/api";
import {
  licenseInit,
  postCreateTrialEnterpriseLicenseToLicenseServer,
  postResendEmailVerificationEmailToLicenseServer,
  postVerifyEmailToLicenseServer,
} from "back-end/src/enterprise";

/**
 * An endpoint mostly used to refresh the license data manually, if they
 * have only recently paid for a subscription or for more seats and don't
 * want to restart their servers.
 */
export async function getLicenseData(req: AuthRequest, res: Response) {
  if (!req.superAdmin) {
    const context = getContextFromReq(req);
    if (!context.permissions.canManageBilling()) {
      context.permissions.throwPermissionError();
    }
  }

  let licenseData;

  if (req.organization?.licenseKey || process.env.LICENSE_KEY) {
    // Force refresh the license data
    licenseData = await licenseInit(
      req.organization,
      getUserCodesForOrg,
      getLicenseMetaData,
      true,
    );
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
  const userEmailCodes = await getUserCodesForOrg(context.org);

  // Create a hmac signature of the license data
  const hmac = crypto.createHmac("sha256", licenseMetaData.installationId);

  const report = {
    timestamp,
    licenseMetaData,
    userEmailCodes,
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
  res: Response<{ status: 200 } | PrivateApiErrorResponse>,
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
      reqContext,
    );

    if (!org.licenseKey) {
      await updateOrganization(org.id, { licenseKey: results.licenseId });
    } else {
      await licenseInit(
        req.organization,
        getUserCodesForOrg,
        getLicenseMetaData,
        true,
      );
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
  res: Response,
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
  res: Response,
) {
  const { emailVerificationToken } = req.body;

  try {
    await postVerifyEmailToLicenseServer(emailVerificationToken);

    // update license info from the license server as if the email was verified then the license data will be changed
    await licenseInit(
      req.organization,
      getUserCodesForOrg,
      getLicenseMetaData,
      true,
    );

    return res.status(200).json({ status: 200 });
  } catch (e) {
    return res.status(500).json({ status: 500, message: e.message });
  }
}
