import { Request, Response } from "express";
import { Stripe } from "stripe";
import {
  LicenseServerError,
  getLicense,
  licenseInit,
  postCreateBillingSessionToLicenseServer,
  postNewProSubscriptionToLicenseServer,
  postNewProTrialSubscriptionToLicenseServer,
  postNewSubscriptionSuccessToLicenseServer,
} from "enterprise";
import {
  APP_ORIGIN,
  STRIPE_PRICE,
  STRIPE_WEBHOOK_SECRET,
} from "../util/secrets";
import { AuthRequest } from "../types/AuthRequest";
import {
  getNumberOfUniqueMembersAndInvites,
  getContextFromReq,
} from "../services/organizations";
import {
  updateSubscriptionInDb,
  stripe,
  getCoupon,
  getPrice,
} from "../services/stripe";
import { SubscriptionQuote } from "../../types/organization";
import { sendStripeTrialWillEndEmail } from "../services/email";
import { logger } from "../util/logger";
import { updateOrganization } from "../models/OrganizationModel";
import {
  getLicenseMetaData,
  getUserCodesForOrg,
} from "../services/licenseData";

function withLicenseServerErrorHandling<T>(
  fn: (req: AuthRequest<T>, res: Response) => Promise<void>
) {
  return async (req: AuthRequest<T>, res: Response) => {
    try {
      return await fn(req, res);
    } catch (e) {
      if (e instanceof LicenseServerError) {
        logger.error(`License server error (${e.status}): ${e.message}`);
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
    res: Response
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
      qty
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
  }
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
      returnUrl
    );
    await updateOrganization(org.id, { licenseKey: result.license.id });

    res.status(200).json(result);
  }
);

export async function getSubscriptionQuote(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageBilling()) {
    context.permissions.throwPermissionError();
  }

  const { org } = context;

  let discountAmount, discountMessage, unitPrice, currentSeatsPaidFor;

  //TODO: Remove once all orgs have moved license info off of the org
  if (!org.licenseKey) {
    const price = await getPrice(org.priceId || STRIPE_PRICE);
    unitPrice = (price?.unit_amount || 2000) / 100;

    const coupon = await getCoupon(org.discountCode);
    discountAmount = (-1 * (coupon?.amount_off || 0)) / 100;
    discountMessage = coupon?.name || "";
    currentSeatsPaidFor = org.subscription?.qty || 0;
  } else {
    const license = await getLicense(org.licenseKey);

    unitPrice = license?.stripeSubscription?.price || 20;
    discountAmount = license?.stripeSubscription?.discountAmount || 0;
    discountMessage = license?.stripeSubscription?.discountMessage || "";
    currentSeatsPaidFor = license?.stripeSubscription?.qty || 0;
  }

  // TODO: handle pricing tiers
  const additionalSeatPrice = unitPrice;
  const activeAndInvitedUsers = getNumberOfUniqueMembersAndInvites(org);
  const subtotal = activeAndInvitedUsers * unitPrice;
  const total = Math.max(0, subtotal + discountAmount);

  const quote: SubscriptionQuote = {
    activeAndInvitedUsers,
    currentSeatsPaidFor,
    unitPrice,
    discountAmount,
    discountMessage,
    subtotal,
    total,
    additionalSeatPrice,
  };

  return res.status(200).json({
    status: 200,
    quote,
  });
}

export const postCreateBillingSession = withLicenseServerErrorHandling(
  async function (req: AuthRequest, res: Response) {
    const context = getContextFromReq(req);

    if (!context.permissions.canManageBilling()) {
      context.permissions.throwPermissionError();
    }

    const { org } = context;

    const license = await getLicense(org.licenseKey);

    let url;
    let status;
    if (license?.id) {
      const results = await postCreateBillingSessionToLicenseServer(license.id);
      url = results.url;
      status = results.status;
    } else {
      // TODO: Remove once all orgs have moved license info off of the org
      if (!org.stripeCustomerId) {
        throw new Error("Missing customer id");
      }

      ({ url } = await stripe.billingPortal.sessions.create({
        customer: org.stripeCustomerId,
        return_url: `${APP_ORIGIN}/settings/billing?org=${org.id}`,
      }));

      status = 200;
    }

    res.status(status).json({
      status: status,
      url,
    });
  }
);

export const postSubscriptionSuccess = withLicenseServerErrorHandling(
  async function (
    req: AuthRequest<{ checkoutSessionId: string }>,
    res: Response
  ) {
    const context = getContextFromReq(req);

    if (!context.permissions.canManageBilling()) {
      context.permissions.throwPermissionError();
    }

    const { org } = context;
    const result = await postNewSubscriptionSuccessToLicenseServer(
      req.body.checkoutSessionId
    );
    org.licenseKey = result.id;
    await updateOrganization(org.id, { licenseKey: result.id });

    // update license info from the license server as it will have changed.
    await licenseInit(org, getUserCodesForOrg, getLicenseMetaData, true);

    res.status(200).json({
      status: 200,
    });
  }
);

export async function postWebhook(req: Request, res: Response) {
  const payload: Buffer = req.body;
  const sig = req.headers["stripe-signature"];
  if (!sig) {
    return res.status(400).send("Missing signature");
  }

  try {
    const event = stripe.webhooks.constructEvent(
      payload,
      sig,
      STRIPE_WEBHOOK_SECRET
    );

    switch (event.type) {
      case "checkout.session.completed": {
        const { subscription } = event.data
          .object as Stripe.Response<Stripe.Checkout.Session>;
        if (subscription) {
          await updateSubscriptionInDb(subscription);
        }
        break;
      }

      case "invoice.paid":
      case "invoice.payment_failed": {
        const { subscription } = event.data
          .object as Stripe.Response<Stripe.Invoice>;
        if (subscription) {
          await updateSubscriptionInDb(subscription);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.deleted":
      case "customer.subscription.updated": {
        const subscription = event.data
          .object as Stripe.Response<Stripe.Subscription>;

        await updateSubscriptionInDb(subscription);
        break;
      }

      case "customer.subscription.trial_will_end": {
        const responseSubscription = event.data
          .object as Stripe.Response<Stripe.Subscription>;
        if (!responseSubscription) return;

        const ret = await updateSubscriptionInDb(responseSubscription);
        if (!ret) return;

        const { organization, subscription, hasPaymentMethod } = ret;
        const billingUrl = `${APP_ORIGIN}/settings/billing?org=${organization.id}`;
        const endDate = subscription.trial_end
          ? new Date(subscription.trial_end * 1000)
          : null;

        if (!endDate) {
          logger.error(
            "No trial end date found for subscription: " + subscription.id
          );
          return;
        }

        await sendStripeTrialWillEndEmail({
          email: organization.ownerEmail,
          organization: organization.name,
          endDate,
          hasPaymentMethod,
          billingUrl,
        });

        break;
      }
    }
  } catch (err) {
    req.log.error(err, "Webhook error");
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  res.status(200).send("Ok");
}
