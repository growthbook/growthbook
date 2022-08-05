import { Request, Response } from "express";
import {
  STRIPE_SECRET,
  APP_ORIGIN,
  STRIPE_PRICE,
  STRIPE_WEBHOOK_SECRET,
} from "../util/secrets";
import { Stripe } from "stripe";
import { AuthRequest } from "../types/AuthRequest";
import { updateOrganization } from "../models/OrganizationModel";
import {
  getNumberOfMembersAndInvites,
  getOrgFromReq,
} from "../services/organizations";
import { updateSubscriptionInDb } from "../services/stripe";
const stripe = new Stripe(STRIPE_SECRET || "", { apiVersion: "2020-08-27" });

type DiscountData = {
  [key: string]: Stripe.Coupon;
};

type PriceData = {
  [key: string]: Stripe.Price;
};

const discountData: DiscountData = {};

const priceData: PriceData = {};

export async function postNewSubscription(
  req: AuthRequest<{ qty: number }>,
  res: Response
) {
  const { qty } = req.body;

  req.checkPermissions("organizationSettings");

  const { org } = getOrgFromReq(req);

  if (!org) {
    throw new Error("No organization found");
  }

  const desiredQty = getNumberOfMembersAndInvites(org);

  if (desiredQty !== qty) {
    throw new Error(
      "Number of users is out of date. Please refresh the page and try again."
    );
  }

  let stripeCustomerId: string;

  if (org.stripeCustomerId) {
    stripeCustomerId = org.stripeCustomerId;
  } else {
    const { id } = await stripe.customers.create({
      metadata: {
        growthBookId: org.id,
        ownerEmail: org.ownerEmail,
      },
      name: org.name,
    });
    stripeCustomerId = id;

    await updateOrganization(org.id, {
      stripeCustomerId: stripeCustomerId,
    });
  }

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
        price: org?.priceId || STRIPE_PRICE,
        quantity: qty,
      },
    ],
    success_url: `${APP_ORIGIN}/settings/team`,
    cancel_url: `${APP_ORIGIN}/settings/team`,
  });
  res.status(200).json({
    status: 200,
    session,
  });
}

export async function getPriceData(req: AuthRequest, res: Response) {
  req.checkPermissions("organizationSettings");

  const { org } = getOrgFromReq(req);

  const priceId = org.priceId || STRIPE_PRICE;

  if (!priceData[priceId]) {
    priceData[priceId] = await stripe.prices.retrieve(priceId, {
      expand: ["tiers"],
    });
  }

  return res.status(200).json({
    status: 200,
    priceData: priceData[priceId],
  });
}

export async function getDiscountData(req: AuthRequest, res: Response) {
  req.checkPermissions("organizationSettings");

  const { org } = getOrgFromReq(req);

  if (!org.discountCode) {
    return res.status(200);
  }

  if (!discountData[org.discountCode]) {
    discountData[org.discountCode] = await stripe.coupons.retrieve(
      org.discountCode
    );
  }

  return res.status(200).json({
    status: 200,
    discountCodeData: discountData[org.discountCode],
  });
}

export async function postCreateBillingSession(
  req: AuthRequest,
  res: Response
) {
  req.checkPermissions("organizationSettings");

  const { org } = getOrgFromReq(req);

  if (!org.stripeCustomerId) {
    throw new Error("Missing customer id");
  }

  const { url } = await stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${APP_ORIGIN}/settings`,
  });

  res.status(200).json({
    status: 200,
    url,
  });
}

export async function postWebhook(req: Request, res: Response) {
  const payload: Buffer = req.body;
  const sig = req.headers["stripe-signature"];
  if (!sig) {
    return res.status(400).send("Missing signature");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(payload, sig);
    console.error(err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "invoice.paid":
    case "invoice.payment_failed": {
      const { subscription } = event.data
        .object as Stripe.Response<Stripe.Invoice>;
      if (subscription) {
        updateSubscriptionInDb(subscription);
      }
      break;
    }

    case "customer.subscription.deleted":
    case "subscription_scheduled.canceled":
    case "customer.subscription.updated": {
      const subscription = event.data
        .object as Stripe.Response<Stripe.Subscription>;

      // Get the current subscription data instead of relying on a potentially outdated event
      const currentStripeSubscriptionData = await stripe.subscriptions.retrieve(
        subscription.id
      );

      updateSubscriptionInDb(currentStripeSubscriptionData);

      break;
    }
  }

  res.status(200).send("Ok");
}
