import { Request, Response } from "express";
import { Stripe } from "stripe";
import {
  APP_ORIGIN,
  STRIPE_PRICE,
  STRIPE_WEBHOOK_SECRET,
  IS_CLOUD,
} from "../util/secrets";
import { AuthRequest } from "../types/AuthRequest";
import {
  getNumberOfUniqueMembersAndInvites,
  getOrgFromReq,
} from "../services/organizations";
import {
  updateSubscriptionInDb,
  stripe,
  getCoupon,
  getPrice,
  getStripeCustomerId,
} from "../services/stripe";
import { SubscriptionQuote } from "../../types/organization";
import { isActiveSubscriptionStatus } from "../util/organization.util";

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

  const { org } = getOrgFromReq(req);

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

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
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
  });
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

  const { org } = getOrgFromReq(req);

  const price = await getPrice(org.priceId || STRIPE_PRICE);
  const unitPrice = (price?.unit_amount || 2000) / 100;

  const coupon = await getCoupon(org.discountCode);
  const discountAmount = (-1 * (coupon?.amount_off || 0)) / 100;
  const discountMessage = coupon?.name || "";

  // TODO: handle pricing tiers
  const additionalSeatPrice = unitPrice;
  const activeAndInvitedUsers = getNumberOfUniqueMembersAndInvites(org);
  const currentSeatsPaidFor = org.subscription?.qty || 0;
  const subtotal = currentSeatsPaidFor * unitPrice;
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

  const { org } = getOrgFromReq(req);

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
    }
  } catch (err) {
    req.log.error(err, "Webhook error");
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  res.status(200).send("Ok");
}
