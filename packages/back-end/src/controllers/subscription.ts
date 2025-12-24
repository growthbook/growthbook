import { Response } from "express";
import { Stripe } from "stripe";
import {
  PaymentMethod,
  StripeAddress,
  TaxIdType,
} from "shared/types/subscriptions";
import { DailyUsage, UsageLimits } from "shared/types/organization";
import {
  LicenseServerError,
  getLicense,
  licenseInit,
  postCreateBillingSessionToLicenseServer,
  postNewProSubscriptionIntentToLicenseServer,
  postNewProSubscriptionToLicenseServer,
  postNewProTrialSubscriptionToLicenseServer,
  postNewSubscriptionSuccessToLicenseServer,
  postNewInlineSubscriptionToLicenseServer,
  postCancelSubscriptionToLicenseServer,
  getPortalUrlFromServer,
  getCustomerDataFromServer,
  updateCustomerDataFromServer,
} from "back-end/src/enterprise";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getNumberOfUniqueMembersAndInvites,
  getContextFromReq,
} from "back-end/src/services/organizations";
import { formatBrandName } from "back-end/src/services/stripe";
import { logger } from "back-end/src/util/logger";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import {
  getLicenseMetaData,
  getUserCodesForOrg,
} from "back-end/src/services/licenseData";
import {
  getDailyUsageForOrg,
  migrateOverageEventsForOrgId,
} from "back-end/src/services/clickhouse";
import {
  createSetupIntent,
  deletePaymentMethodById,
  updateDefaultPaymentMethod,
  getPaymentMethodsByLicenseKey,
  getUsage as getOrgUsage,
} from "back-end/src/enterprise/billing/index";
import { getGrowthbookDatasource } from "back-end/src/models/DataSourceModel";

function withLicenseServerErrorHandling<T>(
  fn: (req: AuthRequest<T>, res: Response) => Promise<void>,
) {
  return async (req: AuthRequest<T>, res: Response) => {
    try {
      return await fn(req, res);
    } catch (e) {
      if (e instanceof LicenseServerError) {
        logger.error(e, `License server error (${e.status}): ${e.message}`);
        return res
          .status(e.status)
          .json({ status: e.status, message: e.message });
      } else {
        throw e;
      }
    }
  };
}

export const postNewProTrialSubscription = withLicenseServerErrorHandling(
  async function (
    req: AuthRequest<{ name: string; email?: string }>,
    res: Response,
  ) {
    const { name: nameFromForm, email: emailFromForm } = req.body;

    const context = getContextFromReq(req);

    const { org, userName, email } = context;

    if (!context.permissions.canManageBilling()) {
      context.permissions.throwPermissionError();
    }

    const qty = getNumberOfUniqueMembersAndInvites(org);

    const result = await postNewProTrialSubscriptionToLicenseServer(
      org.id,
      org.name,
      nameFromForm || userName,
      emailFromForm || email,
      qty,
    );
    if (!org.licenseKey) {
      await updateOrganization(org.id, { licenseKey: result.license.id });
    } else {
      if (org.licenseKey !== result.license.id) {
        throw new Error("Your organization already has a license key.");
      }
      await licenseInit(org, getUserCodesForOrg, getLicenseMetaData, true);
    }

    res.status(200).json(result);
  },
);

export const postNewProSubscriptionIntent = withLicenseServerErrorHandling(
  async function (req: AuthRequest, res: Response) {
    const context = getContextFromReq(req);

    if (!context.permissions.canManageBilling()) {
      context.permissions.throwPermissionError();
    }

    const { org, userName } = context;

    const result = await postNewProSubscriptionIntentToLicenseServer(
      org.id,
      org.name,
      org.ownerEmail,
      userName,
    );
    await updateOrganization(org.id, { licenseKey: result.license.id });

    res.status(200).json({ clientSecret: result.clientSecret });
  },
);

export const postNewProSubscription = withLicenseServerErrorHandling(
  async function (req: AuthRequest<{ returnUrl: string }>, res: Response) {
    let { returnUrl } = req.body;

    if (returnUrl?.[0] !== "/") {
      returnUrl = "/settings/billing";
    }

    const context = getContextFromReq(req);

    if (!context.permissions.canManageBilling()) {
      context.permissions.throwPermissionError();
    }

    const { org, userName } = context;

    const qty = getNumberOfUniqueMembersAndInvites(org);

    const result = await postNewProSubscriptionToLicenseServer(
      org.id,
      org.name,
      org.ownerEmail,
      userName,
      qty,
      returnUrl,
    );
    await updateOrganization(org.id, { licenseKey: result.license.id });

    res.status(200).json(result);
  },
);

export const postInlineProSubscription = withLicenseServerErrorHandling(
  async function (
    req: AuthRequest<{
      email: string;
      additionalEmails: string[];
      taxConfig?: { type: TaxIdType; value: string };
      name: string;
      address?: StripeAddress;
    }>,
    res: Response,
  ) {
    const context = getContextFromReq(req);

    if (!context.permissions.canManageBilling()) {
      context.permissions.throwPermissionError();
    }

    const { org } = context;

    const license = await getLicense(org.licenseKey);

    if (!license) {
      throw new Error("No license found for organization");
    }

    const nonInviteSeatQty = org.members.length;

    const result = await postNewInlineSubscriptionToLicenseServer(
      org.id,
      nonInviteSeatQty,
      req.body.email,
      req.body.additionalEmails,
      req.body.name,
      req.body.address,
      req.body.taxConfig,
    );

    const managedWarehouseDatasource = await getGrowthbookDatasource(context);
    if (managedWarehouseDatasource) {
      // new pro users might have events in the overage_events table if they had
      // use more than 1M events.  This moves those events over to the main table,
      // so that they can see them.
      await migrateOverageEventsForOrgId(org.id);
    }

    res.status(200).json(result);
  },
);

export const postCreateBillingSession = withLicenseServerErrorHandling(
  async function (req: AuthRequest, res: Response) {
    const context = getContextFromReq(req);

    if (!context.permissions.canManageBilling()) {
      context.permissions.throwPermissionError();
    }

    const { org } = context;

    const license = await getLicense(org.licenseKey);

    if (!license?.id) {
      throw new Error("No license key found for organization");
    }

    const results = await postCreateBillingSessionToLicenseServer(license.id);

    res.status(results.status).json({
      status: results.status,
      url: results.url,
    });
  },
);

export const postSubscriptionSuccess = withLicenseServerErrorHandling(
  async function (
    req: AuthRequest<{ checkoutSessionId: string }>,
    res: Response,
  ) {
    const context = getContextFromReq(req);

    if (!context.permissions.canManageBilling()) {
      context.permissions.throwPermissionError();
    }

    const { org } = context;
    const result = await postNewSubscriptionSuccessToLicenseServer(
      req.body.checkoutSessionId,
    );
    org.licenseKey = result.id;
    await updateOrganization(org.id, { licenseKey: result.id });

    // update license info from the license server as it will have changed.
    await licenseInit(org, getUserCodesForOrg, getLicenseMetaData, true);

    res.status(200).json({
      status: 200,
    });
  },
);

export async function cancelSubscription(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageBilling()) {
    context.permissions.throwPermissionError();
  }

  const { org } = context;

  const license = await getLicense(org.licenseKey);

  if (!license?.id) {
    throw new Error("No license found for organization");
  }

  await postCancelSubscriptionToLicenseServer(license.id);

  res.status(200).json({
    status: 200,
  });
}

export async function postSetupIntent(
  req: AuthRequest<null, null>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageBilling()) {
    context.permissions.throwPermissionError();
  }

  const { org } = context;

  try {
    if (!org.licenseKey) {
      throw new Error("No license key found for organization");
    }
    const { clientSecret } = await createSetupIntent(org.licenseKey);
    return res.status(200).json({ clientSecret });
  } catch (e) {
    return res.status(400).json({ status: 400, message: e.message });
  }
}

export async function updateCustomerDefaultPayment(
  req: AuthRequest<{ paymentMethodId: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageBilling()) {
    context.permissions.throwPermissionError();
  }

  const { org } = context;
  const { paymentMethodId } = req.body;

  try {
    if (!org.licenseKey) {
      throw new Error("No license key found for organization");
    }
    await updateDefaultPaymentMethod(org.licenseKey, paymentMethodId);
  } catch (e) {
    return res.status(400).json({ status: 400, message: e.message });
  }
  res.status(200).json({
    status: 200,
  });
}

export async function fetchPaymentMethods(
  req: AuthRequest<null, null>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageBilling()) {
    context.permissions.throwPermissionError();
  }

  const { org } = context;
  try {
    if (!org.licenseKey) {
      throw new Error("No license key found for organization");
    }
    const {
      paymentMethods,
      defaultPaymentMethod,
    }: {
      paymentMethods: Stripe.PaymentMethod[];
      defaultPaymentMethod: string | undefined;
    } = await getPaymentMethodsByLicenseKey(org.licenseKey);

    if (!paymentMethods.length) {
      return res.status(200).json({ status: 200, cards: [] });
    }

    const formattedPaymentMethods: PaymentMethod[] = paymentMethods.map(
      (method) => {
        const isDefault = method.id === defaultPaymentMethod;
        if (method.card) {
          return {
            id: method.id,
            type: "card",
            last4: method.card.last4,
            brand: formatBrandName(method.card.brand),
            expMonth: method.card.exp_month,
            expYear: method.card.exp_year,
            isDefault,
            wallet: method.card.wallet?.type
              ? formatBrandName(method.card.wallet.type)
              : undefined,
          };
        } else if (method.us_bank_account) {
          return {
            id: method.id,
            type: "us_bank_account",
            last4: method.us_bank_account.last4 || "",
            brand: formatBrandName(
              method.us_bank_account.bank_name || method.type,
            ),
            isDefault,
          };
        } else {
          return {
            id: method.id,
            type: "unknown",
            brand: formatBrandName(method.type),
            isDefault,
          };
        }
      },
    );

    return res
      .status(200)
      .json({ status: 200, paymentMethods: formattedPaymentMethods });
  } catch (e) {
    return res.status(400).json({ status: 400, message: e.message });
  }
}

export async function deletePaymentMethod(
  req: AuthRequest<{ paymentMethodId: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageBilling()) {
    context.permissions.throwPermissionError();
  }

  const { org } = context;
  const { paymentMethodId } = req.body;

  try {
    if (!org.licenseKey) {
      throw new Error("No license key found for organization");
    }
    await deletePaymentMethodById(org.licenseKey, paymentMethodId);
  } catch (e) {
    return res.status(400).json({ status: 400, message: e.message });
  }
  res.status(200).json({
    status: 200,
  });
}

export async function getUsage(
  req: AuthRequest<unknown, unknown, { monthsAgo?: number }>,
  res: Response<{
    status: 200;
    usage: DailyUsage[];
    limits: UsageLimits;
  }>,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canViewUsage()) {
    context.permissions.throwPermissionError();
  }

  const monthsAgo = Math.round(req.query.monthsAgo || 0);
  if (monthsAgo < 0 || monthsAgo > 12) {
    throw new Error("Usage data only available for the past 12 months");
  }

  const { org } = context;

  // Beginning of the month
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCMonth(start.getUTCMonth() - monthsAgo);

  // End of the month
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  end.setUTCHours(23, 59, 59, 999);

  const usage = await getDailyUsageForOrg(org.id, start, end);

  const {
    limits: {
      requests: cdnRequests,
      bandwidth: cdnBandwidth,
      managedClickhouseEvents,
    },
  } = await getOrgUsage(org);

  res.json({
    status: 200,
    usage,
    limits: {
      cdnRequests,
      cdnBandwidth,
      managedClickhouseEvents,
    },
  });
}

export async function getCustomerData(
  req: AuthRequest<null, null>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageBilling()) {
    context.permissions.throwPermissionError();
  }

  try {
    const customerData = await getCustomerDataFromServer(context.org.id);

    return res.status(200).json(customerData);
  } catch (e) {
    return res.status(400).json({ status: 400, message: e.message });
  }
}

export async function getPortalUrl(
  req: AuthRequest<null, null>,
  res: Response<{ status: number; portalUrl?: string; message?: string }>,
) {
  const context = getContextFromReq(req);

  const { org } = context;

  if (!context.permissions.canViewUsage()) {
    context.permissions.throwPermissionError();
  }

  try {
    const data = await getPortalUrlFromServer(org.id);

    res.status(200).json({
      status: 200,
      portalUrl: data.portalUrl,
    });
  } catch (e) {
    return res.status(400).json({ status: 400, message: e.message });
  }
}

export async function updateCustomerData(
  req: AuthRequest<{
    name: string;
    email: string;
    address?: StripeAddress;
    taxConfig: { type?: TaxIdType; value?: string };
  }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  const { org } = context;

  if (!context.permissions.canManageBilling()) {
    context.permissions.throwPermissionError();
  }

  try {
    await updateCustomerDataFromServer(org.id, {
      name: req.body.name,
      email: req.body.email,
      address: req.body.address,
      taxConfig: req.body.taxConfig,
    });
    return res.status(200).json({ status: 200 });
  } catch (e) {
    return res.status(400).json({ status: 400, message: e.message });
  }
}
