import { Request, Response } from "express";
import { Stripe } from "stripe";
import { isActiveSubscriptionStatus } from "enterprise";
import {
  getNumberOfUniqueMembersAndInvites,
  getContextFromReq,
} from "@back-end/src/services/organizations";
import {
  updateSubscriptionInDb,
  stripe,
  getCoupon,
  getPrice,
  getStripeCustomerId,
} from "@back-end/src/services/stripe";
import { sendStripeTrialWillEndEmail } from "@back-end/src/services/email";
import {
  APP_ORIGIN,
  STRIPE_PRICE,
  STRIPE_WEBHOOK_SECRET,
  IS_CLOUD,
} from "@back-end/src/util/secrets";
import { logger } from "@back-end/src/util/logger";
import { SubscriptionQuote } from "@back-end/types/organization";
import { AuthRequest } from "@back-end/src/types/AuthRequest";

export async function postNewSubscription(
  req: AuthRequest<{ qty: number; returnUrl: string }>,
  res: Response
) {
  const { qty } = req.body;

  let { returnUrl } = req.body;

  if (returnUrl?.[0] !== "/") {
    returnUrl = "/settings/billing";
  }

  req.checkPermissions("manageBilling");

  const { org } = getContextFromReq(req);

  const desiredQty = getNumberOfUniqueMembersAndInvites(org);

  if (desiredQty !== qty) {
    throw new Error(
      "Number of users is out of date. Please refresh the page and try again."
    );
  }

  const stripeCustomerId = await getStripeCustomerId(org);

  const existingSubscriptions = await stripe.subscriptions.list({
    customer: stripeCustomerId,
  });

  const promises = existingSubscriptions.data.map(async (subscription) => {
    if (isActiveSubscriptionStatus(subscription.status)) {
      await updateSubscriptionInDb(subscription);

      throw new Error(
        "Existing subscription found. Please refresh the page or go to Settings > Billing to manage your existing subscription."
      );
    }
  });
  await Promise.all(promises);

  const startFreeTrial = !org.freeTrialDate;

  const payload: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    payment_method_types: ["card", "us_bank_account"],
    customer: stripeCustomerId,
    discounts: [
      {
        coupon: org.discountCode,
      },
    ],
    line_items: [
      {
        price: org.priceId || STRIPE_PRICE,
        quantity: qty,
      },
    ],
    success_url: `${APP_ORIGIN}/settings/team?org=${org.id}&subscription-success-session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_ORIGIN}${returnUrl}?org=${org.id}`,
  };

  if (startFreeTrial) {
    payload.subscription_data = {
      trial_period_days: 14,
      trial_settings: {
        end_behavior: {
          missing_payment_method: "cancel",
        },
      },
    };
    payload.payment_method_collection = "if_required";
  }

  const session = await stripe.checkout.sessions.create(payload);

  res.status(200).json({
    status: 200,
    session,
  });
}

export async function getSubscriptionQuote(req: AuthRequest, res: Response) {
  req.checkPermissions("manageBilling");

  if (!IS_CLOUD) {
    return res.status(200).json({
      status: 200,
      quote: null,
    });
  }

  const { org } = getContextFromReq(req);

  const price = await getPrice(org.priceId || STRIPE_PRICE);
  const unitPrice = (price?.unit_amount || 2000) / 100;

  const coupon = await getCoupon(org.discountCode);
  const discountAmount = (-1 * (coupon?.amount_off || 0)) / 100;
  const discountMessage = coupon?.name || "";

  // TODO: handle pricing tiers
  const additionalSeatPrice = unitPrice;
  const activeAndInvitedUsers = getNumberOfUniqueMembersAndInvites(org);
  const currentSeatsPaidFor = org.subscription?.qty || 0;
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

export async function postCreateBillingSession(
  req: AuthRequest,
  res: Response
) {
  req.checkPermissions("manageBilling");

  const { org } = getContextFromReq(req);

  if (!org.stripeCustomerId) {
    throw new Error("Missing customer id");
  }

  const { url } = await stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${APP_ORIGIN}/settings/billing?org=${org.id}`,
  });

  res.status(200).json({
    status: 200,
    url,
  });
}

export async function postSubscriptionSuccess(
  req: AuthRequest<{ checkoutSessionId: string }>,
  res: Response
) {
  req.checkPermissions("manageBilling");

  const session = await stripe.checkout.sessions.retrieve(
    req.body.checkoutSessionId
  );

  const subscription = session.subscription;

  if (!subscription) {
    throw new Error("No subscription associated with that checkout session");
  }

  await updateSubscriptionInDb(subscription);

  res.status(200).json({
    status: 200,
  });
}

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
